//! What Data Studio offers over MCP (mcp.rs): reading tables (with calculated formulas), column statistics and writing
//! new CSV files. Only CSV / TSV files are written, and an existing one only with `overwrite`.

use crate::engine::{self, Table};
use crate::formula::V;
use crate::{mcp, stats, table, view};
use serde_json::{json, Value};
use std::path::Path;

pub fn run() { mcp::serve("data-studio", env!("CARGO_PKG_VERSION"), &tools(), &call) }

const DEFAULT_ROWS: usize = 100;

fn tools() -> Vec<Value> {
    let path = json!({"type": "string", "description": "Full path of the file (CSV, TSV, JSON, JSON Lines, Excel, ODS)"});
    let sheet = json!({"type": "string", "description": "Name of the sheet; default: the first"});
    vec![
        mcp::tool("table_info", "The sheets of a data file with their numbers of rows and columns, and the first row.", json!({"path": path}), &["path"]),
        mcp::tool("table_read", "Reads rows of a table. Formula cells show their result, or the formula itself with formulas: true.",
            json!({"path": path, "sheet": sheet, "offset": {"type": "integer"}, "limit": {"type": "integer", "description": "Default 100"}, "formulas": {"type": "boolean"}}), &["path"]),
        mcp::tool("column_stats", "Statistics of a column (0 is the first): count, empty, unique, sum, average, quantiles, most frequent values.",
            json!({"path": path, "sheet": sheet, "column": {"type": "integer"}}), &["path", "column"]),
        mcp::tool("write_csv", "Writes rows to a new .csv or .tsv file. Replaces an existing file only with overwrite.",
            json!({"path": {"type": "string", "description": "Full path of the file"}, "rows": {"type": "array", "items": {"type": "array"}}, "overwrite": {"type": "boolean"}}), &["path", "rows"]),
    ]
}

/// All sheets of a file as [(name, rows)], the way the app reads them.
fn sheets(p: &Path) -> Result<Vec<(String, Vec<Vec<Value>>)>, String> {
    let bytes = std::fs::read(p).map_err(|e| format!("{}: {e}", p.display()))?;
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let base = p.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if matches!(ext.as_str(), "xlsx" | "xlsm" | "xls" | "xlsb" | "ods") {
        return Ok(table::read_spreadsheet(&bytes, &ext)?.into_iter().map(|s| {
            let rows = s["rows"].as_array().into_iter().flatten().map(|r| r.as_array().cloned().unwrap_or_default()).collect();
            (s["name"].as_str().unwrap_or("").to_string(), rows)
        }).collect());
    }
    let (text, _, _) = table::decode(&bytes);
    let rows = match ext.as_str() {
        "json" => table::json_to_rows(&serde_json::from_str::<Value>(&text).map_err(|e| e.to_string())?),
        "jsonl" | "ndjson" => {
            let items = text.lines().filter(|l| !l.trim().is_empty()).map(serde_json::from_str::<Value>).collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
            table::json_to_rows(&Value::Array(items))
        }
        "tsv" | "tab" => table::parse_csv(&text, b'\t'),
        _ => table::parse_csv(&text, table::detect_delimiter(&text)),
    };
    Ok(vec![(base, rows)])
}

fn sheet(args: &Value) -> Result<(String, Vec<Vec<Value>>), String> {
    let all = sheets(&mcp::path(args, "path")?)?;
    let want = mcp::opt_text(args, "sheet");
    if want.is_empty() { return all.into_iter().next().ok_or_else(|| "the file has no sheets".to_string()); }
    let names: Vec<String> = all.iter().map(|s| s.0.clone()).collect();
    all.into_iter().find(|s| s.0 == want).ok_or_else(|| format!("no sheet {want}; there are: {}", names.join(", ")))
}

/// The engine's table: the app's date cells ({"$date": n}) become its {"$d": n}, formulas get calculated.
fn calculated(rows: &[Vec<Value>]) -> Table {
    let cell = |v: &Value| match v.get("$date") { Some(d) => engine::from_json(&json!({"$d": d})), None => engine::from_json(v) };
    let rows: Vec<Vec<V>> = rows.iter().map(|r| r.iter().map(cell).collect()).collect();
    let cols = rows.iter().map(Vec::len).max().unwrap_or(0);
    let types: Vec<view::ColType> = (0..cols).map(|c| {
        static EMPTY: V = V::Empty;
        view::detect(&view::sample(|r| rows[r].get(c).unwrap_or(&EMPTY), rows.len()))
    }).collect();
    let german: Vec<bool> = types.iter().map(|t| t.german).collect();
    let today = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| (d.as_secs() / 86_400) as f64 + 25_569.0).unwrap_or(0.0);
    let fv = engine::calc_table(&rows, &german, today).into_iter().map(|(r, c, v)| ((r, c), engine::from_json(&v))).collect();
    let view = (0..rows.len()).collect();
    Table { rows, types, fv, view }
}

fn read(args: &Value) -> Result<Value, String> {
    let (name, rows) = sheet(args)?;
    let total = rows.len();
    let number = |k: &str, or: usize| args.get(k).and_then(Value::as_u64).map_or(or, |n| n as usize);
    let (offset, limit) = (number("offset", 0).min(total), number("limit", DEFAULT_ROWS));
    let end = offset.saturating_add(limit).min(total);
    let shown: Vec<Value> = if mcp::flag(args, "formulas") {
        rows[offset..end].iter().map(|r| json!(r)).collect()
    } else {
        let t = calculated(&rows);
        (offset..end).map(|r| json!((0..rows[r].len()).map(|c| engine::to_json(t.value(r, c))).collect::<Vec<_>>())).collect()
    };
    Ok(json!({"sheet": name, "totalRows": total, "offset": offset, "rows": shown}))
}

fn write_csv(args: &Value) -> Result<Value, String> {
    let p = mcp::path(args, "path")?;
    let delimiter = if mcp::has_ext(&p, &["csv"]) { b',' } else if mcp::has_ext(&p, &["tsv"]) { b'\t' } else { return Err(format!("{}: not a .csv or .tsv file", p.display())) };
    let rows = args.get("rows").and_then(Value::as_array).ok_or("rows is needed")?;
    let mut w = csv::WriterBuilder::new().delimiter(delimiter).flexible(true).from_writer(Vec::new());
    for row in rows {
        let cells = row.as_array().ok_or("rows: expected arrays")?.iter().map(|v| match v {
            Value::String(s) => s.clone(),
            Value::Null => String::new(),
            other => other.to_string(),
        });
        w.write_record(cells).map_err(|e| e.to_string())?;
    }
    mcp::put(&p, &w.into_inner().map_err(|e| e.to_string())?, mcp::flag(args, "overwrite"))?;
    Ok(json!({"path": p, "rows": rows.len()}))
}

fn call(name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "table_info" => {
            let list: Vec<Value> = sheets(&mcp::path(args, "path")?)?.iter().map(|(name, rows)| json!({"name": name, "rows": rows.len(),
                "columns": rows.iter().map(Vec::len).max().unwrap_or(0), "firstRow": rows.first()})).collect();
            Ok(json!({"sheets": list}))
        }
        "table_read" => read(args),
        "column_stats" => {
            let (name, rows) = sheet(args)?;
            let t = calculated(&rows);
            let c = args.get("column").and_then(Value::as_u64).ok_or("column is needed")? as usize;
            if c >= t.types.len() { return Err(format!("column {c}: the table has {} columns", t.types.len())); }
            Ok(json!({"sheet": name, "column": c, "stats": serde_json::to_value(stats::col_stats(&t, c)).map_err(|e| e.to_string())?}))
        }
        "write_csv" => write_csv(args),
        _ => Err(format!("unknown tool: {name}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn tables() {
        let d = std::env::temp_dir().join(format!("data-mcp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        let f = d.join("noten.csv");
        call("write_csv", &json!({"path": f, "rows": [["Fach", "Note"], ["Mathe", 2], ["Bio", 4], ["Summe", "=B2+B3"]]})).unwrap();
        assert!(call("write_csv", &json!({"path": f, "rows": []})).is_err(), "nothing is overwritten unless asked");
        assert!(call("write_csv", &json!({"path": d.join("x.sh"), "rows": []})).is_err(), "only CSV files");

        let info = call("table_info", &json!({"path": f})).unwrap();
        assert_eq!((info["sheets"][0]["rows"].as_u64(), info["sheets"][0]["columns"].as_u64()), (Some(4), Some(2)));

        let page = call("table_read", &json!({"path": f, "offset": 1, "limit": 1})).unwrap();
        assert_eq!((page["totalRows"].as_u64(), page["rows"].as_array().unwrap().len()), (Some(4), 1));
        assert_eq!(page["rows"][0][0], "Mathe");
        let last = call("table_read", &json!({"path": f, "offset": 3})).unwrap();
        assert_eq!(last["rows"][0][1], 6.0, "formulas are calculated");
        let raw = call("table_read", &json!({"path": f, "offset": 3, "formulas": true})).unwrap();
        assert_eq!(raw["rows"][0][1], "=B2+B3");
        assert_eq!(call("table_read", &json!({"path": f, "offset": 99})).unwrap()["rows"], json!([]));

        let st = call("column_stats", &json!({"path": f, "column": 1})).unwrap();
        assert_eq!(st["stats"]["values"], 4);
        assert!(call("column_stats", &json!({"path": f, "column": 9})).is_err());
        assert!(call("table_read", &json!({"path": f, "sheet": "Nope"})).is_err());
        let _ = fs::remove_dir_all(d);
    }
}
