//! Excel workbooks with their formatting (umya-spreadsheet).
//!
//! Reading turns a workbook into a compact JSON model for the UI: sparse cells, a style table
//! (fonts, colors, fills, borders, alignment, number formats — colors already resolved from the theme),
//! merged cells, column widths and row heights. The original umya styles stay here (per document token),
//! so cells whose formatting wasn't edited are written back exactly as they were (theme colors, protection …).
//! Writing starts from the original file when there is one, replaces cells, merges and sizes, and keeps
//! everything else of the workbook: dropdown lists, conditional formats, frozen panes, print setup, images.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    io::Cursor,
    str::FromStr,
    sync::Mutex,
};
use tauri::{
    ipc::{Request, Response},
    State,
};
use umya_spreadsheet::{
    reader, writer, Border, BorderStyleValues, Color, HorizontalAlignmentValues, PatternValues, Spreadsheet, Style,
    VerticalAlignmentValues,
};

/// Original styles of each open workbook, by document token.
#[derive(Default)]
pub struct Styles(Mutex<HashMap<u64, Vec<Style>>>);

#[derive(Serialize)]
struct SheetOut {
    name: String,
    rows: u32,
    cols: u32,
    /// [row, col, kind, value, style]; rows/cols 0-based; kind: n number, d date (Excel serial), s text, b bool, f formula, e error
    cells: Vec<Value>,
    merges: Vec<[u32; 4]>,
    /// [col, width (Excel units), hidden]
    widths: Vec<(u32, f64, bool)>,
    heights: Vec<(u32, f64)>,
}

fn hex(c: &Color, book: &Spreadsheet) -> Option<String> {
    let argb = c.get_argb_with_theme(book.get_theme());
    let s = argb.trim();
    if s.is_empty() {
        return None;
    }
    let rgb = if s.len() == 8 { &s[2..] } else { s };
    (rgb.len() == 6).then(|| format!("#{}", rgb.to_ascii_uppercase()))
}

fn is_date_code(code: &str, id: u32) -> bool {
    if (14..=22).contains(&id) || (45..=47).contains(&id) {
        return true;
    }
    let mut plain = String::new();
    let mut quoted = false;
    let mut chars = code.chars();
    while let Some(ch) = chars.next() {
        match ch {
            '"' => quoted = !quoted,
            '\\' => {
                chars.next();
            }
            '[' if !quoted => {
                // [h], [mm] are elapsed time; [Red], [$€-407] are not date parts
                let inner: String = chars.by_ref().take_while(|c| *c != ']').collect();
                if inner.chars().all(|c| "hHmMsS".contains(c)) {
                    plain.push('h');
                }
            }
            c if !quoted => plain.push(c),
            _ => {}
        }
    }
    let p = plain.to_lowercase();
    p.chars().any(|c| "ydhs".contains(c) || c == 'm') && !p.contains('#') && !p.contains('?') && !p.starts_with('0') && p != "general"
}

/// The compact style the UI renders (and edits).
fn style_json(st: &Style, book: &Spreadsheet) -> Value {
    let mut o = Map::new();
    if let Some(f) = st.get_font() {
        if *f.get_bold() { o.insert("b".into(), json!(1)); }
        if *f.get_italic() { o.insert("i".into(), json!(1)); }
        { use umya_spreadsheet::EnumTrait; if f.get_font_underline().get_val().get_value_string() != "none" { o.insert("u".into(), json!(1)); } }
        if *f.get_strikethrough() { o.insert("s".into(), json!(1)); }
        if let Some(c) = hex(f.get_color(), book) { o.insert("fc".into(), json!(c)); }
        let size = *f.get_size();
        if size > 0.0 && (size - 11.0).abs() > 0.01 { o.insert("fs".into(), json!(size)); }
        let name = f.get_name();
        if !name.is_empty() && !name.eq_ignore_ascii_case("calibri") { o.insert("fn".into(), json!(name)); }
    }
    if let Some(fill) = st.get_fill() {
        if let Some(p) = fill.get_pattern_fill() {
            if !matches!(p.get_pattern_type(), PatternValues::None) {
                let c = p.get_foreground_color().and_then(|c| hex(c, book)).or_else(|| p.get_background_color().and_then(|c| hex(c, book)));
                if let Some(c) = c { o.insert("bg".into(), json!(c)); }
            }
        } else if let Some(g) = fill.get_gradient_fill() {
            if let Some(stop) = g.get_gradient_stop().first() {
                if let Some(c) = hex(stop.get_color(), book) { o.insert("bg".into(), json!(c)); }
            }
        }
    }
    if let Some(a) = st.get_alignment() {
        use umya_spreadsheet::EnumTrait;
        let h = a.get_horizontal().get_value_string();
        if h != "general" { o.insert("ha".into(), json!(h)); }
        let v = a.get_vertical().get_value_string();
        if v != "bottom" { o.insert("va".into(), json!(v)); }
        if *a.get_wrap_text() { o.insert("wrap".into(), json!(1)); }
    }
    if let Some(b) = st.get_borders() {
        let mut bd = Map::new();
        for (k, side) in [("t", b.get_top()), ("r", b.get_right()), ("b", b.get_bottom()), ("l", b.get_left())] {
            let s = side.get_border_style();
            if !s.is_empty() && s != "none" {
                bd.insert(k.into(), json!([s, hex(side.get_color(), book)]));
            }
        }
        if !bd.is_empty() { o.insert("bd".into(), Value::Object(bd)); }
    }
    if let Some(nf) = st.get_number_format() {
        let code = nf.get_format_code();
        if !code.is_empty() && code != "General" {
            o.insert("nf".into(), json!(code));
            if is_date_code(code, *nf.get_number_format_id()) { o.insert("date".into(), json!(1)); }
        }
    }
    Value::Object(o)
}

fn parse_range(r: &str) -> Option<[u32; 4]> {
    let mut parts = r.split(':');
    let a = parse_cell(parts.next()?)?;
    let b = parts.next().and_then(parse_cell).unwrap_or(a);
    Some([a.0, a.1, b.0 - a.0 + 1, b.1 - a.1 + 1])
}

/// "B3" -> (row 2, col 1)
fn parse_cell(s: &str) -> Option<(u32, u32)> {
    let s = s.replace('$', "");
    let split = s.find(|c: char| c.is_ascii_digit())?;
    let (letters, digits) = s.split_at(split);
    let mut col = 0u32;
    for ch in letters.chars() {
        col = col * 26 + (ch.to_ascii_uppercase() as u32 - 64);
    }
    Some((digits.parse::<u32>().ok()? - 1, col.checked_sub(1)?))
}

fn col_letters(mut c: u32) -> String {
    let mut s = String::new();
    c += 1;
    while c > 0 {
        let m = (c - 1) % 26;
        s.insert(0, (b'A' + m as u8) as char);
        c = (c - 1) / 26;
    }
    s
}

#[tauri::command]
pub async fn xlsx_read(app: tauri::AppHandle, styles: State<'_, Styles>, request: Request<'_>) -> Result<Value, String> {
    let bytes = crate::request_bytes(&app, &request)?;
    crate::progress_busy(&app, &request, "parse");
    let (mut model, table) = read_model(&bytes)?;
    let token = {
        let mut map = styles.0.lock().unwrap();
        let t = map.keys().max().copied().unwrap_or(0) + 1;
        map.insert(t, table);
        t
    };
    model["token"] = json!(token);
    model["size"] = json!(bytes.len());
    Ok(model)
}

fn read_model(bytes: &[u8]) -> Result<(Value, Vec<Style>), String> {
    let book = reader::xlsx::read_reader(Cursor::new(bytes.to_vec()), true).map_err(|e| e.to_string())?;
    let mut table: Vec<Style> = vec![Style::default()];
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut out_styles: Vec<Value> = vec![json!({})];
    let mut intern = |st: &Style| -> usize {
        let js = style_json(st, &book);
        if js.as_object().map_or(true, |m| m.is_empty()) && st == &Style::default() {
            return 0;
        }
        // The same look can come from different umya styles (e.g. protection flags); keep them apart.
        let key = format!("{js}|{:?}", st);
        *index.entry(key).or_insert_with(|| {
            table.push(st.clone());
            out_styles.push(js);
            table.len() - 1
        })
    };
    let mut sheets = Vec::new();
    for ws in book.get_sheet_collection() {
        let (hc, hr) = ws.get_highest_column_and_row();
        let mut cells = Vec::new();
        for cell in ws.get_cell_collection_sorted() {
            let co = cell.get_coordinate();
            let (r, c) = (*co.get_row_num() - 1, *co.get_col_num() - 1);
            let st = intern(cell.get_style());
            let date = cell.get_style().get_number_format().is_some_and(|nf| is_date_code(nf.get_format_code(), *nf.get_number_format_id()));
            let (kind, value) = if cell.is_formula() {
                ("f", json!(cell.get_formula()))
            } else {
                match cell.get_data_type() {
                    "n" => match cell.get_value_number() {
                        Some(n) => (if date { "d" } else { "n" }, json!(n)),
                        None => ("s", json!(cell.get_value())),
                    },
                    "b" => ("b", json!(cell.get_value() == "TRUE" || cell.get_value() == "1")),
                    "e" => ("e", json!(cell.get_value())),
                    _ => ("s", json!(cell.get_value())),
                }
            };
            let empty = kind == "s" && value.as_str().is_some_and(str::is_empty);
            if empty && st == 0 {
                continue;
            }
            cells.push(json!([r, c, kind, value, st]));
        }
        let merges = ws.get_merge_cells().iter().filter_map(|m| parse_range(&m.get_range())).collect();
        let widths = ws.get_column_dimensions().iter().map(|c| (*c.get_col_num() - 1, *c.get_width(), *c.get_hidden())).collect();
        let heights = ws
            .get_row_dimensions()
            .iter()
            .filter(|r| *r.get_custom_height() && *r.get_height() > 0.0)
            .map(|r| (*r.get_row_num() - 1, *r.get_height()))
            .collect();
        sheets.push(SheetOut { name: ws.get_name().to_string(), rows: hr, cols: hc, cells, merges, widths, heights });
    }
    Ok((json!({"styles": out_styles, "sheets": sheets}), table))
}

/* ---------------- Writing ---------------- */

#[derive(Deserialize)]
pub struct WriteReq {
    /// Original file to keep everything the app doesn't model (dropdowns, conditional formats, images …).
    original: Option<String>,
    token: Option<u64>,
    sheets: Vec<SheetIn>,
}

#[derive(Deserialize)]
struct SheetIn {
    name: String,
    /// [row, col, kind, value, style] — style: id from reading, or {"base": id, "set": {...}}, or null
    cells: Vec<(u32, u32, String, Value, Value)>,
    merges: Vec<[u32; 4]>,
    widths: Vec<(u32, f64, bool)>,
    heights: Vec<(u32, f64)>,
}

fn argb(hex: &str) -> String {
    format!("FF{}", hex.trim_start_matches('#').to_ascii_uppercase())
}

/// Applies the UI's edits ({"b":1,"bg":"#FFFF00",…}; null removes a property) to a style.
fn apply_set(st: &mut Style, set: &Map<String, Value>) {
    for (k, v) in set {
        let on = v.as_bool().unwrap_or_else(|| v.as_i64().is_some_and(|n| n != 0));
        match k.as_str() {
            "b" => { st.get_font_mut().set_bold(on); }
            "i" => { st.get_font_mut().set_italic(on); }
            "u" => { st.get_font_mut().set_underline(if on { "single" } else { "none" }); }
            "s" => { st.get_font_mut().set_strikethrough(on); }
            "fc" => match v.as_str() {
                Some(c) => { st.get_font_mut().get_color_mut().set_argb(argb(c)); }
                None => { st.get_font_mut().set_color(Color::default()); }
            },
            "fs" => if let Some(n) = v.as_f64() { st.get_font_mut().set_size(n); },
            "fn" => if let Some(n) = v.as_str() { st.get_font_mut().set_name(n); },
            "bg" => match v.as_str() {
                Some(c) => {
                    let p = st.get_fill_mut().get_pattern_fill_mut();
                    p.set_pattern_type(PatternValues::Solid);
                    p.get_foreground_color_mut().set_argb(argb(c));
                }
                None => { st.remove_fill(); }
            },
            "ha" => {
                let h = v.as_str().and_then(|s| HorizontalAlignmentValues::from_str(s).ok()).unwrap_or(HorizontalAlignmentValues::General);
                st.get_alignment_mut().set_horizontal(h);
            }
            "va" => {
                let a = v.as_str().and_then(|s| VerticalAlignmentValues::from_str(s).ok()).unwrap_or(VerticalAlignmentValues::Bottom);
                st.get_alignment_mut().set_vertical(a);
            }
            "wrap" => { st.get_alignment_mut().set_wrap_text(on); }
            "nf" => match v.as_str() {
                Some(code) => { st.get_number_format_mut().set_format_code(code); }
                None => { st.remove_number_format(); }
            },
            "bd" => match v.as_str() {
                Some("all") => {
                    let b = st.get_borders_mut();
                    let mut thin = Border::default();
                    thin.set_style(BorderStyleValues::Thin);
                    b.set_top(thin.clone());
                    b.set_bottom(thin.clone());
                    b.set_left(thin.clone());
                    b.set_right(thin);
                }
                _ => { st.remove_borders(); }
            },
            "clear" => { *st = Style::default(); }
            _ => {}
        }
    }
}

#[tauri::command]
pub async fn xlsx_write(styles: State<'_, Styles>, req: WriteReq) -> Result<Response, String> {
    let table: Vec<Style> = req.token.and_then(|t| styles.0.lock().unwrap().get(&t).cloned()).unwrap_or_default();
    write_model(&req, &table).map(Response::new)
}

fn write_model(req: &WriteReq, table: &[Style]) -> Result<Vec<u8>, String> {
    let mut book = match req.original.as_deref().filter(|p| std::path::Path::new(p).is_file()) {
        Some(p) => reader::xlsx::read(p).map_err(|e| e.to_string())?,
        None => umya_spreadsheet::new_file_empty_worksheet(),
    };
    let base = |id: u64| table.get(id as usize).cloned().unwrap_or_default();

    // Sheets that no longer exist in the document are removed; missing ones are added.
    while book.get_sheet_count() > req.sheets.len() {
        let last = book.get_sheet_count() - 1;
        book.remove_sheet(last).map_err(|e| e.to_string())?;
    }
    for (i, s) in req.sheets.iter().enumerate() {
        if book.get_sheet(&i).is_none() {
            let mut ws = umya_spreadsheet::Worksheet::default();
            ws.set_name(format!("Sheet{}", i + 1));
            book.add_sheet(ws).map_err(|e| e.to_string())?;
        }
        let ws = book.get_sheet_mut(&i).ok_or("sheet missing")?;
        ws.set_name(s.name.chars().take(31).collect::<String>());
        ws.get_collection_to_hashmap_mut().clear();
        ws.get_merge_cells_mut().clear();
        for (r, c, kind, value, style) in &s.cells {
            let cell = ws.get_cell_mut((c + 1, r + 1));
            match kind.as_str() {
                "f" => { cell.set_formula(value.as_str().unwrap_or("").trim_start_matches('=')); }
                "n" | "d" => if let Some(n) = value.as_f64() { cell.set_value_number(n); },
                "b" => { cell.set_value_bool(value.as_bool().unwrap_or(false)); }
                "e" | "s" => if let Some(t) = value.as_str() { if !t.is_empty() { cell.set_value_string(t); } },
                _ => {}
            }
            let st = match style {
                Value::Number(n) => Some(base(n.as_u64().unwrap_or(0))),
                Value::Object(o) => {
                    let mut st = base(o.get("base").and_then(Value::as_u64).unwrap_or(0));
                    if let Some(Value::Object(set)) = o.get("set") { apply_set(&mut st, set); }
                    Some(st)
                }
                _ => None,
            };
            if let Some(st) = st { cell.set_style(st); }
        }
        for m in &s.merges {
            let range = format!("{}{}:{}{}", col_letters(m[1]), m[0] + 1, col_letters(m[1] + m[3] - 1), m[0] + m[2]);
            ws.add_merge_cells(range);
        }
        for (c, w, hidden) in &s.widths {
            let col = ws.get_column_dimension_by_number_mut(&(c + 1));
            col.set_width(*w);
            col.set_hidden(*hidden);
        }
        for (r, h) in &s.heights {
            let row = ws.get_row_dimension_mut(&(r + 1));
            row.set_height(*h);
            row.set_custom_height(true);
        }
    }
    let mut out = Cursor::new(Vec::new());
    writer::xlsx::write_writer(&book, &mut out).map_err(|e| e.to_string())?;
    Ok(out.into_inner())
}

/// Forgets a closed document's styles.
#[tauri::command]
pub fn xlsx_forget(styles: State<Styles>, token: u64) {
    styles.0.lock().unwrap().remove(&token);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn date_codes() {
        assert!(is_date_code("dd.mm.yyyy", 164));
        assert!(is_date_code("[$-407]dddd, d. mmmm yyyy", 165));
        assert!(is_date_code("h:mm", 20));
        assert!(!is_date_code("#,##0.00 \"€\"", 166));
        assert!(!is_date_code("0.00%", 10));
        assert!(!is_date_code("General", 0));
    }
    /// Formatting written by the app comes back when the file is read again; untouched styles stay identical.
    #[test]
    fn round_trip() {
        let req: WriteReq = serde_json::from_value(json!({
            "original": null, "token": null,
            "sheets": [{"name": "Umsatz", "merges": [[0, 0, 1, 3]], "widths": [[0, 22.5, false]], "heights": [[0, 30.0]],
                "cells": [
                    [0, 0, "s", "Titel", {"base": 0, "set": {"b": 1, "fs": 14, "ha": "center", "bg": "#FFFF00"}}],
                    [1, 0, "n", 1234.5, {"base": 0, "set": {"nf": "#,##0.00 \"€\"", "bd": "all", "fc": "#C00000"}}],
                    [1, 1, "d", 45000, {"base": 0, "set": {"nf": "dd.mm.yyyy"}}],
                    [1, 2, "f", "A2*2", null],
                    [1, 3, "b", true, null]
                ]}]
        })).unwrap();
        let bytes = write_model(&req, &[]).unwrap();
        let (model, table) = read_model(&bytes).unwrap();
        let sheet = &model["sheets"][0];
        assert_eq!(sheet["name"], "Umsatz");
        assert_eq!(sheet["merges"][0], json!([0, 0, 1, 3]));
        let cells = sheet["cells"].as_array().unwrap();
        let find = |r: u64, c: u64| cells.iter().find(|x| x[0] == r && x[1] == c).unwrap().clone();
        let st = |cell: &Value| model["styles"][cell[4].as_u64().unwrap() as usize].clone();
        let title = find(0, 0);
        assert_eq!(st(&title)["b"], 1); assert_eq!(st(&title)["bg"], "#FFFF00"); assert_eq!(st(&title)["ha"], "center"); assert_eq!(st(&title)["fs"], 14.0);
        let money = find(1, 0);
        assert_eq!(money[3], 1234.5); assert_eq!(st(&money)["nf"], "#,##0.00 \"€\""); assert_eq!(st(&money)["fc"], "#C00000"); assert!(st(&money)["bd"]["l"].is_array());
        let date = find(1, 1);
        assert_eq!(date[2], "d"); assert_eq!(st(&date)["date"], 1);
        assert_eq!(find(1, 2)[2], "f"); assert_eq!(find(1, 2)[3], "A2*2");
        assert_eq!(find(1, 3)[3], true);
        assert!((sheet["widths"].as_array().unwrap().iter().find(|w| w[0] == 0).unwrap()[1].as_f64().unwrap() - 22.5).abs() < 0.8);
        // Writing again by style id keeps the exact same style object.
        let id = title[4].as_u64().unwrap();
        let req2: WriteReq = serde_json::from_value(json!({"original": null, "token": null,
            "sheets": [{"name": "S", "merges": [], "widths": [], "heights": [], "cells": [[0, 0, "s", "x", id]]}]})).unwrap();
        let (m2, t2) = read_model(&write_model(&req2, &table).unwrap()).unwrap();
        assert_eq!(m2["styles"][m2["sheets"][0]["cells"][0][4].as_u64().unwrap() as usize], model["styles"][id as usize]);
        assert_eq!(t2.len(), 2);
    }
    /// Writes a formatted test workbook to $XLSX_FIXTURE (run with --ignored).
    #[test]
    #[ignore]
    fn fixture() {
        use umya_spreadsheet::{DataValidation, DataValidationValues, DataValidations, SequenceOfReferences};
        let Ok(path) = std::env::var("XLSX_FIXTURE") else { return };
        let req: WriteReq = serde_json::from_value(json!({"original": null, "token": null, "sheets": [{"name": "Umsatz",
            "merges": [[0, 0, 1, 4]], "widths": [[0, 18.0, false], [1, 14.0, false], [2, 16.0, false], [3, 12.0, false], [4, 30.0, false]], "heights": [],
            "cells": [
                [0, 0, "s", "Quartalsbericht", {"base": 0, "set": {"b": 1, "fs": 14, "ha": "center", "bg": "#1F4E78", "fc": "#FFFFFF"}}],
                [1, 0, "s", "Produkt", {"base": 0, "set": {"b": 1, "bd": "all"}}], [1, 1, "s", "Umsatz", {"base": 0, "set": {"b": 1, "bd": "all"}}],
                [1, 2, "s", "Datum", {"base": 0, "set": {"b": 1, "bd": "all"}}], [1, 3, "s", "Anteil", {"base": 0, "set": {"b": 1, "bd": "all"}}],
                [1, 4, "s", "Notiz", {"base": 0, "set": {"b": 1, "bd": "all"}}],
                [2, 0, "s", "Äpfel", null], [2, 1, "n", 1234.5, {"base": 0, "set": {"nf": "#,##0.00 \"€\""}}], [2, 2, "d", 45940, {"base": 0, "set": {"nf": "dd.mm.yyyy"}}],
                [2, 3, "n", 0.255, {"base": 0, "set": {"nf": "0.0%"}}], [2, 4, "s", "Sehr langer Text, der umgebrochen werden soll", {"base": 0, "set": {"wrap": 1, "i": 1}}],
                [3, 0, "s", "Birnen", null], [3, 1, "n", 987.25, {"base": 0, "set": {"nf": "#,##0.00 \"€\"", "fc": "#C00000"}}], [3, 2, "d", 45941, {"base": 0, "set": {"nf": "dd.mm.yyyy"}}],
                [3, 3, "f", "B4/SUM(B3:B4)", {"base": 0, "set": {"nf": "0.0%"}}], [3, 4, "s", "ok", {"base": 0, "set": {"bg": "#FFFF00"}}]
            ]}]})).unwrap();
        let bytes = write_model(&req, &[]).unwrap();
        let mut book = reader::xlsx::read_reader(Cursor::new(bytes), true).unwrap();
        let ws = book.get_sheet_mut(&0).unwrap();
        let mut dv = DataValidation::default();
        dv.set_type(DataValidationValues::List);
        dv.set_formula1("\"Äpfel,Birnen,Kirschen\"");
        let mut sq = SequenceOfReferences::default();
        sq.set_sqref("A3:A20");
        dv.set_sequence_of_references(sq);
        let mut dvs = DataValidations::default();
        dvs.add_data_validation_list(dv);
        ws.set_data_validations(dvs);
        writer::xlsx::write(&book, &path).unwrap();
    }
    /// Prints what a saved workbook contains (run with --ignored, $XLSX_CHECK = path).
    #[test]
    #[ignore]
    fn inspect() {
        let Ok(path) = std::env::var("XLSX_CHECK") else { return };
        let bytes = std::fs::read(&path).unwrap();
        let (model, _) = read_model(&bytes).unwrap();
        let book = reader::xlsx::read(&path).unwrap();
        let ws = book.get_sheet(&0).unwrap();
        let dv = ws.get_data_validations().map(|d| d.get_data_validation_list().len()).unwrap_or(0);
        println!("DROPDOWNS={dv}");
        println!("MODEL={}", model);
    }
    #[test]
    fn ranges() {
        assert_eq!(parse_range("B2:D5"), Some([1, 1, 4, 3]));
        assert_eq!(col_letters(27), "AB");
    }
}
