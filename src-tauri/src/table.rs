//! Reading and writing of data files in Rust: CSV / TSV (separator detected), JSON, JSON Lines,
//! and old spreadsheet formats (.xls, .ods via calamine). Excel .xlsx is in `xlsx.rs`.
//!
//! Reading returns `{format, encoding, bom, delimiter, sheets: [{name, rows}]}` where `rows` is an array of rows
//! (strings, numbers, booleans; dates from spreadsheets as `{"$date": excel serial}`; formulas as "=…").
//! Writing takes the finished cell values from the UI (formulas are still calculated there) and encodes them.

use calamine::{open_workbook_auto_from_rs, Data, Ods, Range, Reader, Xls, Xlsb};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::io::Cursor;
use tauri::ipc::{Request, Response};

/* ---------------- Text decoding ---------------- */

/// UTF-8 (with or without BOM), UTF-16 with BOM, otherwise Windows-1252 (old Excel CSV exports).
pub fn decode(bytes: &[u8]) -> (String, &'static str, bool) {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return (String::from_utf8_lossy(rest).into_owned(), "UTF-8 (BOM)", true);
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return (encoding_rs::UTF_16LE.decode_without_bom_handling(&bytes[2..]).0.into_owned(), "UTF-16 LE", true);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return (encoding_rs::UTF_16BE.decode_without_bom_handling(&bytes[2..]).0.into_owned(), "UTF-16 BE", true);
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_string(), "UTF-8", false),
        Err(_) => (encoding_rs::WINDOWS_1252.decode_without_bom_handling(bytes).0.into_owned(), "Windows-1252", false),
    }
}

/* ---------------- CSV ---------------- */

fn csv_reader(text: &str, delim: u8) -> csv::Reader<&[u8]> {
    csv::ReaderBuilder::new().delimiter(delim).has_headers(false).flexible(true).from_reader(text.as_bytes())
}

/// The separator that splits the first lines into the most consistent number of fields (like spreadsheet apps guess it).
pub fn detect_delimiter(text: &str) -> u8 {
    let sample: String = text.lines().take(60).collect::<Vec<_>>().join("\n");
    let mut best = (b',', 0.0f64);
    for d in [b',', b';', b'\t', b'|'] {
        let counts: Vec<usize> = csv_reader(&sample, d).records().filter_map(Result::ok).filter(|r| !r.iter().all(str::is_empty)).map(|r| r.len()).collect();
        if counts.is_empty() {
            continue;
        }
        let first = counts[0] as f64;
        if first < 2.0 {
            continue;
        }
        let same = counts.iter().filter(|&&n| n as f64 == first).count() as f64 / counts.len() as f64;
        let score = same * 100.0 + first.min(50.0);
        if score > best.1 {
            best = (d, score);
        }
    }
    best.0
}

#[cfg(test)]
pub fn parse_csv(text: &str, delim: u8) -> Vec<Vec<Value>> {
    parse_csv_progress(text, delim, |_| {})
}

/// Like parse_csv, telling `progress` how many bytes are done (about every 1 % of the text).
pub fn parse_csv_progress(text: &str, delim: u8, mut progress: impl FnMut(usize)) -> Vec<Vec<Value>> {
    let step = (text.len() / 100).max(1 << 16);
    let mut next = step;
    let mut out = Vec::new();
    for r in csv_reader(text, delim).records().filter_map(Result::ok) {
        let at = r.position().map_or(0, |p| p.byte() as usize);
        if at >= next { progress(at); next = at + step; }
        if r.iter().all(|f| f.trim().is_empty()) { continue; }
        out.push(r.iter().map(|f| Value::String(f.to_string())).collect());
    }
    out
}

/* ---------------- JSON ---------------- */

fn flatten(o: &Map<String, Value>, prefix: &str, out: &mut Map<String, Value>, depth: usize) {
    for (k, v) in o {
        let key = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
        match v {
            Value::Object(inner) if depth < 3 => flatten(inner, &key, out, depth + 1),
            Value::Object(_) | Value::Array(_) => {
                out.insert(key, Value::String(v.to_string()));
            }
            _ => {
                out.insert(key, v.clone());
            }
        }
    }
}

fn cell(v: &Value) -> Value {
    match v {
        Value::Null => Value::String(String::new()),
        Value::Object(_) | Value::Array(_) => Value::String(v.to_string()),
        _ => v.clone(),
    }
}

fn objects_to_rows(list: &[&Map<String, Value>]) -> Vec<Vec<Value>> {
    let flat: Vec<Map<String, Value>> = list.iter().map(|o| { let mut m = Map::new(); flatten(o, "", &mut m, 0); m }).collect();
    let mut keys: Vec<String> = Vec::new();
    for o in &flat {
        for k in o.keys() {
            if keys.len() >= 2000 { break; }
            if !keys.contains(k) { keys.push(k.clone()); }
        }
    }
    let mut rows = vec![keys.iter().map(|k| Value::String(k.clone())).collect()];
    rows.extend(flat.iter().map(|o| keys.iter().map(|k| o.get(k).map(cell).unwrap_or_else(|| Value::String(String::new()))).collect()));
    rows
}

/// Turns any JSON shape into a table: list of objects, list of lists, object of columns, object of objects, …
pub fn json_to_rows(data: &Value) -> Vec<Vec<Value>> {
    let col_name = |i: usize| { let mut s = String::new(); let mut n = i + 1; while n > 0 { let m = (n - 1) % 26; s.insert(0, (b'A' + m as u8) as char); n = (n - 1) / 26; } s };
    match data {
        Value::Array(items) => {
            if !items.is_empty() && items.iter().all(Value::is_object) {
                let objs: Vec<&Map<String, Value>> = items.iter().filter_map(Value::as_object).collect();
                return objects_to_rows(&objs);
            }
            if !items.is_empty() && items.iter().all(Value::is_array) {
                let rows: Vec<Vec<Value>> = items.iter().map(|r| r.as_array().unwrap().iter().map(cell).collect()).collect();
                if rows[0].iter().all(Value::is_string) {
                    return rows;
                }
                let head = (0..rows[0].len()).map(|i| Value::String(col_name(i))).collect();
                return std::iter::once(head).chain(rows).collect();
            }
            std::iter::once(vec![json!("value")]).chain(items.iter().map(|v| vec![cell(v)])).collect()
        }
        Value::Object(o) => {
            let vals: Vec<&Value> = o.values().collect();
            let len = vals.first().and_then(|v| v.as_array()).map(Vec::len);
            if let Some(n) = len {
                if vals.iter().all(|v| v.as_array().is_some_and(|a| a.len() == n && a.iter().all(|x| !x.is_object()))) {
                    let mut rows = vec![o.keys().map(|k| Value::String(k.clone())).collect::<Vec<_>>()];
                    for i in 0..n {
                        rows.push(vals.iter().map(|v| cell(&v.as_array().unwrap()[i])).collect());
                    }
                    return rows;
                }
            }
            if !vals.is_empty() && vals.iter().all(|v| v.is_object()) {
                let withkey: Vec<Map<String, Value>> = o
                    .iter()
                    .map(|(k, v)| { let mut m = Map::new(); m.insert("key".into(), json!(k)); m.extend(v.as_object().unwrap().clone()); m })
                    .collect();
                return objects_to_rows(&withkey.iter().collect::<Vec<_>>());
            }
            if let Some((_, Value::Array(list))) = o.iter().find(|(_, v)| v.as_array().is_some_and(|a| a.first().is_some_and(Value::is_object))) {
                let objs: Vec<&Map<String, Value>> = list.iter().filter_map(Value::as_object).collect();
                return objects_to_rows(&objs);
            }
            let mut flat = Map::new();
            flatten(o, "", &mut flat, 0);
            std::iter::once(vec![json!("key"), json!("value")]).chain(flat.iter().map(|(k, v)| vec![json!(k), cell(v)])).collect()
        }
        other => vec![vec![json!("value")], vec![cell(other)]],
    }
}

/* ---------------- Old spreadsheets (.xls, .ods) ---------------- */

/// All sheets as (name, values, formulas), with the reader chosen by extension (auto-detection as a fallback).
fn load_sheets(bytes: &[u8], ext: &str) -> Result<Vec<(String, Range<Data>, Option<Range<String>>)>, String> {
    fn all<R: Reader<Cursor<Vec<u8>>>>(mut wb: R) -> Result<Vec<(String, Range<Data>, Option<Range<String>>)>, String>
    where
        R::Error: std::fmt::Display,
    {
        let mut out = Vec::new();
        for name in wb.sheet_names() {
            let values = wb.worksheet_range(&name).map_err(|e| e.to_string())?;
            let formulas = wb.worksheet_formula(&name).ok();
            out.push((name, values, formulas));
        }
        Ok(out)
    }
    let fixed;
    let bytes = if ext == "ods" && Ods::new(Cursor::new(bytes.to_vec())).is_err() { fixed = tidy_ods(bytes).unwrap_or_else(|| bytes.to_vec()); &fixed[..] } else { bytes };
    let cur = || Cursor::new(bytes.to_vec());
    let typed = match ext {
        "ods" => Ods::new(cur()).map_err(|e| e.to_string()).and_then(all),
        "xls" => Xls::new(cur()).map_err(|e| e.to_string()).and_then(all),
        "xlsb" => Xlsb::new(cur()).map_err(|e| e.to_string()).and_then(all),
        _ => Err(String::new()),
    };
    typed.or_else(|_| open_workbook_auto_from_rs(cur()).map_err(|e| e.to_string()).and_then(all))
}

/// Some writers (e.g. SheetJS, which Data Studio uses to save .ods) indent the XML of an .ods file; the reader expects
/// no text between table cells. Removes line breaks + indentation between tags in content.xml (cell text is untouched).
fn tidy_ods(bytes: &[u8]) -> Option<Vec<u8>> {
    use std::io::{Read, Write};
    let mut zin = zip::ZipArchive::new(Cursor::new(bytes)).ok()?;
    let mut zout = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for i in 0..zin.len() {
        let mut f = zin.by_index(i).ok()?;
        let name = f.name().to_string();
        let mut data = Vec::new();
        f.read_to_end(&mut data).ok()?;
        if name == "content.xml" {
            let text = String::from_utf8(data).ok()?;
            let mut out = String::with_capacity(text.len());
            let mut rest = text.as_str();
            while let Some(p) = rest.find(">\n") {
                out.push_str(&rest[..p + 1]);
                let after = rest[p + 1..].trim_start_matches(|c: char| c == '\n' || c == '\r' || c == ' ' || c == '\t');
                if !after.starts_with('<') { out.push_str(&rest[p + 1..rest.len() - after.len()]); }
                rest = after;
            }
            out.push_str(rest);
            data = out.into_bytes();
        }
        let method = if name == "mimetype" { zip::CompressionMethod::Stored } else { zip::CompressionMethod::Deflated };
        zout.start_file(name, zip::write::SimpleFileOptions::default().compression_method(method)).ok()?;
        zout.write_all(&data).ok()?;
    }
    Some(zout.finish().ok()?.into_inner())
}

/// OpenDocument formulas -> Excel style: "of:=SUM([.A1:.B2];[Tabelle2.C3])" -> "SUM(A1:B2,Tabelle2!C3)".
pub fn from_open_formula(s: &str) -> String {
    let s = s.trim();
    let s = s.strip_prefix("of:").unwrap_or(s);
    let s = s.strip_prefix('=').unwrap_or(s);
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                out.push(ch);
                for c in chars.by_ref() { out.push(c); if c == '"' { break; } }
            }
            '[' => {
                let inner: String = chars.by_ref().take_while(|c| *c != ']').collect();
                let parts: Vec<String> = inner
                    .split(':')
                    .map(|p| {
                        let p = p.trim_start_matches('$');
                        match p.split_once('.') {
                            Some(("", cell)) => cell.to_string(),
                            Some((sheet, cell)) => format!("{}!{cell}", sheet.trim_start_matches('$').trim_matches('\'')),
                            None => p.to_string(),
                        }
                    })
                    .collect();
                out.push_str(&parts.join(":"));
            }
            ';' => out.push(','),
            _ => out.push(ch),
        }
    }
    out
}

fn read_spreadsheet(bytes: &[u8], ext: &str) -> Result<Vec<Value>, String> {
    let mut sheets = Vec::new();
    for (name, values, formulas) in load_sheets(bytes, ext)? {
        // Rows and columns as in the file, starting at A1, so formula references stay right.
        let (vr, vc) = values.end().map(|(r, c)| (r as usize + 1, c as usize + 1)).unwrap_or((0, 0));
        let (fr, fc) = formulas.as_ref().and_then(|f| f.end()).map(|(r, c)| (r as usize + 1, c as usize + 1)).unwrap_or((0, 0));
        let (rows, cols) = (vr.max(fr), vc.max(fc));
        let mut grid = vec![vec![Value::String(String::new()); cols]; rows];
        if let Some((r0, c0)) = values.start() {
            for (i, row) in values.rows().enumerate() {
                for (j, v) in row.iter().enumerate() {
                    grid[r0 as usize + i][c0 as usize + j] = match v {
                        Data::Int(n) => json!(n),
                        Data::Float(f) => json!(f),
                        Data::String(s) => json!(s),
                        Data::Bool(b) => json!(b),
                        Data::DateTime(d) => json!({"$date": d.as_f64()}),
                        Data::DateTimeIso(s) | Data::DurationIso(s) => json!(s),
                        Data::Error(e) => json!(format!("{e}")),
                        Data::Empty => json!(""),
                    };
                }
            }
        }
        if let Some(f) = formulas {
            if let Some((r0, c0)) = f.start() {
                for (i, row) in f.rows().enumerate() {
                    for (j, s) in row.iter().enumerate() {
                        if !s.is_empty() {
                            let f = if ext == "ods" { from_open_formula(s) } else { s.trim_start_matches('=').to_string() };
                            grid[r0 as usize + i][c0 as usize + j] = json!(format!("={f}"));
                        }
                    }
                }
            }
        }
        // Without formulas, leading and fully empty rows are dropped (like before); with formulas rows must stay in place.
        let has_formulas = grid.iter().flatten().any(|v| v.as_str().is_some_and(|s| s.starts_with('=')));
        if !has_formulas {
            grid.retain(|r| r.iter().any(|v| v.as_str() != Some("")));
        }
        sheets.push(json!({"name": name, "rows": grid}));
    }
    Ok(sheets)
}

/* ---------------- Commands ---------------- */

fn header_name(req: &Request) -> String {
    req.headers().get("x-name").and_then(|v| v.to_str().ok()).map(|s| crate::percent_decode(s)).unwrap_or_default()
}

/// Reads a data file. Body: the file's bytes; header `x-name`: its name (the extension decides the format).
#[tauri::command]
pub async fn table_read(app: tauri::AppHandle, request: Request<'_>) -> Result<Value, String> {
    let bytes = crate::request_bytes(&app, &request)?;
    let bytes: &[u8] = &bytes;
    let size = bytes.len();
    let csv_like = |e: &str| !matches!(e, "xls" | "ods" | "xlsb" | "json" | "jsonl" | "ndjson");
    let name = header_name(&request);
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let base = name.rsplit_once('.').map(|(b, _)| b.to_string()).unwrap_or(name.clone());
    if !csv_like(&ext) { crate::progress_busy(&app, &request, "parse"); }
    if matches!(ext.as_str(), "xls" | "ods" | "xlsb") {
        return Ok(json!({"format": ext, "encoding": "", "bom": false, "delimiter": "", "sheets": read_spreadsheet(bytes, &ext)?}));
    }
    let (text, encoding, bom) = decode(bytes);
    let sheet = |rows: Vec<Vec<Value>>| json!([{"name": base, "rows": rows}]);
    if ext == "json" {
        match serde_json::from_str::<Value>(&text) {
            Ok(v) => return Ok(json!({"format": "json", "encoding": encoding, "bom": bom, "delimiter": "", "sheets": sheet(json_to_rows(&v))})),
            Err(e) if !text.trim_start().starts_with('{') => return Err(e.to_string()),
            Err(_) => {} // maybe JSON Lines with a .json name
        }
    }
    if matches!(ext.as_str(), "json" | "jsonl" | "ndjson") {
        let items = text
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| serde_json::from_str::<Value>(l))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        return Ok(json!({"format": "jsonl", "encoding": encoding, "bom": bom, "delimiter": "", "sheets": sheet(json_to_rows(&Value::Array(items)))}));
    }
    let delim = if matches!(ext.as_str(), "tsv" | "tab") { b'\t' } else { detect_delimiter(&text) };
    let format = if ext == "tab" { "tsv".to_string() } else { ext };
    // With header x-progress: "load-progress" events while the rows are read (the loading bar).
    let id: Option<u64> = request.headers().get("x-progress").and_then(|v| v.to_str().ok()).and_then(|s| s.parse().ok());
    let total = text.len();
    let rows = parse_csv_progress(&text, delim, |done| {
        if let Some(id) = id { use tauri::Emitter; let _ = app.emit("load-progress", json!({"id": id, "phase": "parse", "done": done, "total": total})); }
    });
    if let Some(id) = id { use tauri::Emitter; let _ = app.emit("load-progress", json!({"id": id, "phase": "parse", "done": total, "total": total})); }
    Ok(json!({"format": format, "encoding": encoding, "bom": bom, "delimiter": (delim as char).to_string(), "sheets": sheet(rows), "size": size}))
}

#[derive(Deserialize)]
pub struct WriteReq {
    /// csv | json | jsonl | md
    format: String,
    #[serde(default)]
    delimiter: Option<String>,
    #[serde(default)]
    bom: bool,
    /// For json/jsonl/md: the column names; `rows` then hold only data.
    #[serde(default)]
    columns: Vec<String>,
    /// For md: which columns are numbers (right-aligned).
    #[serde(default)]
    numeric: Vec<bool>,
    rows: Vec<Vec<Value>>,
}

fn text_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

pub fn write_table(req: &WriteReq) -> Result<Vec<u8>, String> {
    let mut out: Vec<u8> = if req.bom { vec![0xEF, 0xBB, 0xBF] } else { Vec::new() };
    match req.format.as_str() {
        "csv" => {
            let delim = req.delimiter.as_deref().and_then(|d| d.bytes().next()).unwrap_or(b',');
            let mut w = csv::WriterBuilder::new().delimiter(delim).terminator(csv::Terminator::CRLF).flexible(true).from_writer(Vec::new());
            for row in &req.rows {
                w.write_record(row.iter().map(text_of)).map_err(|e| e.to_string())?;
            }
            out.extend(w.into_inner().map_err(|e| e.to_string())?);
        }
        "json" | "jsonl" => {
            let objs: Vec<Value> = req
                .rows
                .iter()
                .map(|r| Value::Object(req.columns.iter().zip(r.iter().chain(std::iter::repeat(&Value::Null))).map(|(k, v)| (k.clone(), v.clone())).collect()))
                .collect();
            let text = if req.format == "json" {
                serde_json::to_string_pretty(&objs).map_err(|e| e.to_string())? + "\n"
            } else {
                objs.iter().map(|o| o.to_string() + "\n").collect()
            };
            out.extend(text.into_bytes());
        }
        "md" => {
            let esc = |s: String| s.replace('|', "\\|").replace("\r\n", "<br>").replace('\n', "<br>");
            let mut text = format!("| {} |\n", req.columns.iter().map(|c| esc(c.clone())).collect::<Vec<_>>().join(" | "));
            text += &format!("|{}|\n", (0..req.columns.len()).map(|i| if req.numeric.get(i) == Some(&true) { "---:" } else { ":---" }).collect::<Vec<_>>().join("|"));
            for r in &req.rows {
                text += &format!("| {} |\n", r.iter().map(|v| esc(text_of(v))).collect::<Vec<_>>().join(" | "));
            }
            out.extend(text.into_bytes());
        }
        f => return Err(format!("unknown format {f}")),
    }
    Ok(out)
}

#[tauri::command]
pub async fn table_write(req: WriteReq) -> Result<Response, String> {
    write_table(&req).map(Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Prints calamine's errors for $TABLE_PROBE (run with --ignored).
    #[test]
    #[ignore]
    fn probe() {
        let Ok(dir) = std::env::var("TABLE_PROBE") else { return };
        for (f, ext) in [("gen.ods", "ods"), ("gen.xls", "xls")] {
            let bytes = std::fs::read(format!("{dir}/{f}")).unwrap();
            let typed = match ext { "ods" => Ods::new(Cursor::new(bytes.clone())).map(|_| ()).map_err(|e| e.to_string()), _ => Xls::new(Cursor::new(bytes.clone())).map(|_| ()).map_err(|e| e.to_string()) };
            println!("PROBE {f}: open={typed:?} read={:?}", read_spreadsheet(&bytes, ext).map(|s| s.len()));
        }
    }
    #[test]
    fn open_formulas() {
        assert_eq!(from_open_formula("of:=[.C2]*2"), "C2*2");
        assert_eq!(from_open_formula("of:=SUM([.A1:.B2];[$Tabelle2.C3])"), "SUM(A1:B2,Tabelle2!C3)");
        assert_eq!(from_open_formula("of:=IF([.A1]>1;\"a;b\";0.5)"), "IF(A1>1,\"a;b\",0.5)");
    }
    #[test]
    fn delimiters() {
        assert_eq!(detect_delimiter("a;b;c\n1;2,5;3\n4;5;6"), b';');
        assert_eq!(detect_delimiter("a,b\n1,2\n3,4"), b',');
        assert_eq!(detect_delimiter("a\tb\tc\n1\t2\t3"), b'\t');
        assert_eq!(detect_delimiter("Name;Preis\n\"Äpfel, rot\";1,20"), b';');
    }
    #[test]
    fn csv_quotes_and_empty_lines() {
        let rows = parse_csv("a,b\n\"x, y\",\"he said \"\"hi\"\"\"\n\n,\n3,4\n", b',');
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[1][0], "x, y");
        assert_eq!(rows[1][1], "he said \"hi\"");
    }
    #[test]
    fn decoding() {
        assert_eq!(decode(&[0xEF, 0xBB, 0xBF, b'a']).1, "UTF-8 (BOM)");
        let (t, e, _) = decode(&[b'K', 0xE4, b's', b'e']);   // "Käse" in Windows-1252
        assert_eq!((t.as_str(), e), ("Käse", "Windows-1252"));
    }
    #[test]
    fn json_shapes() {
        let v: Value = serde_json::from_str(r#"[{"name":"A","n":1,"tags":["x"],"adr":{"ort":"Berlin"}},{"name":"B","extra":true}]"#).unwrap();
        let rows = json_to_rows(&v);
        assert_eq!(rows[0], vec![json!("name"), json!("n"), json!("tags"), json!("adr.ort"), json!("extra")]);
        assert_eq!(rows[1][2], json!("[\"x\"]"));
        assert_eq!(rows[2][4], json!(true));
        let cols: Value = serde_json::from_str(r#"{"a":[1,2],"b":[3,4]}"#).unwrap();
        assert_eq!(json_to_rows(&cols), vec![vec![json!("a"), json!("b")], vec![json!(1), json!(3)], vec![json!(2), json!(4)]]);
    }
    #[test]
    fn writing() {
        let req = WriteReq { format: "csv".into(), delimiter: Some(";".into()), bom: true, columns: vec![], numeric: vec![],
            rows: vec![vec![json!("Name"), json!("Preis")], vec![json!("Äpfel; rot"), json!("1,20")]] };
        let out = write_table(&req).unwrap();
        assert_eq!(&out[..3], &[0xEF, 0xBB, 0xBF]);
        assert_eq!(String::from_utf8(out[3..].to_vec()).unwrap(), "Name;Preis\r\n\"Äpfel; rot\";1,20\r\n");
        let req = WriteReq { format: "json".into(), delimiter: None, bom: false, columns: vec!["a".into(), "b".into()], numeric: vec![],
            rows: vec![vec![json!(1), json!("x")]] };
        let v: Value = serde_json::from_slice(&write_table(&req).unwrap()).unwrap();
        assert_eq!(v, json!([{"a": 1, "b": "x"}]));
    }
}
