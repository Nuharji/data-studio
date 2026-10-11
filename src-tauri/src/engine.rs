//! The calculation engine: a copy of every open table lives here, and all formulas are calculated here
//! (see formula.rs). The UI sends the table once (`engine_load`), single cell edits afterwards (`engine_set`),
//! and gets the results of all formula cells back (`engine_calc`).
//!
//! Cell values in JSON: text, numbers, booleans, "" for empty, {"$d": excel serial} for dates.
//! Results: the same, plus {"$e": "#DIV/0!"} for errors.

use crate::formula::{Calc, V};
use crate::view::{compute_view, detect, sample, ColType, ViewReq};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};
use tauri::State;

/// One open table: its cells, and what the last `engine_update` worked out for it (column types, formula results,
/// visible rows) — the statistics and charts (stats.rs) use exactly what the table shows.
#[derive(Default)]
pub struct Table {
    pub rows: Vec<Vec<V>>,
    pub types: Vec<ColType>,
    pub fv: HashMap<(usize, usize), V>,
    pub view: Vec<usize>,
}

impl Table {
    /// What a cell holds after calculation (formula cells: their result).
    pub fn value(&self, r: usize, c: usize) -> &V {
        static EMPTY: V = V::Empty;
        match self.rows.get(r).and_then(|row| row.get(c)) {
            Some(v) if is_formula(v) => self.fv.get(&(r, c)).unwrap_or(&EMPTY),
            Some(v) => v,
            None => &EMPTY,
        }
    }
}

#[derive(Default)]
pub struct Engine(pub Mutex<HashMap<u64, Table>>);

pub fn from_json(v: &Value) -> V {
    match v {
        Value::Null => V::Empty,
        Value::Bool(b) => V::Bool(*b),
        Value::Number(n) => V::Num(n.as_f64().unwrap_or(0.0)),
        Value::String(s) if s.is_empty() => V::Empty,
        Value::String(s) => V::Str(s.clone()),
        Value::Object(o) => match o.get("$d").and_then(Value::as_f64) {
            Some(d) => V::Date(d),
            None => V::Str(v.to_string()),
        },
        Value::Array(_) => V::Str(v.to_string()),
    }
}

pub fn to_json(v: &V) -> Value {
    match v {
        V::Empty => json!(""),
        V::Num(n) => json!(n),
        V::Str(s) => json!(s),
        V::Bool(b) => json!(b),
        V::Date(d) => json!({"$d": d}),
        V::Err(e) => json!({"$e": e}),
        V::Arr(a) => a.first().map(to_json).unwrap_or(json!("")),
    }
}

/// Text that looks like a number, in English ("1,234.5") or German ("1.234,5") style — the same rules the UI uses.
pub fn to_number(s: &str, german: bool) -> Option<f64> {
    let t = s.trim();
    if t.is_empty() || t == "-" || t == "+" || t == "." { return None; }
    let body = t.strip_prefix(['+', '-']).unwrap_or(t);
    let neg = t.starts_with('-');
    let (group, dec) = if german { ('.', ',') } else { (',', '.') };
    let (int, frac) = match body.split_once(dec) { Some((a, b)) => (a, Some(b)), None => (body, None) };
    // English numbers may carry an exponent on the fraction or integer part.
    let (frac, exp) = if german { (frac, None) } else {
        let target = frac.unwrap_or(int);
        match target.find(['e', 'E']) {
            Some(p) => {
                let (a, e) = target.split_at(p);
                if frac.is_some() { (Some(a), Some(&e[1..])) } else { return parse_exp(a, &e[1..], neg, None); }
            }
            None => (frac, None),
        }
    };
    let int_ok = if int.contains(group) {
        let parts: Vec<&str> = int.split(group).collect();
        !parts[0].is_empty() && parts[0].len() <= 3 && parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit()))
            && parts[1..].iter().all(|p| p.len() == 3)
    } else {
        int.chars().all(|c| c.is_ascii_digit()) && (!int.is_empty() || (!german && frac.is_some()))
    };
    let frac_ok = frac.is_none_or(|f| !f.is_empty() && f.chars().all(|c| c.is_ascii_digit()));
    if !int_ok || !frac_ok { return None; }
    let digits = format!("{}{}", int.replace(group, ""), frac.map(|f| format!(".{f}")).unwrap_or_default());
    match exp {
        Some(e) => parse_exp(&digits, e, neg, Some(())),
        None => digits.parse::<f64>().ok().map(|n| if neg { -n } else { n }),
    }
}

fn parse_exp(mant: &str, exp: &str, neg: bool, _f: Option<()>) -> Option<f64> {
    let e = exp.strip_prefix('+').unwrap_or(exp);
    if e.is_empty() || !e.trim_start_matches('-').chars().all(|c| c.is_ascii_digit()) || !mant.chars().all(|c| c.is_ascii_digit() || c == '.') { return None; }
    format!("{mant}e{e}").parse::<f64>().ok().map(|n| if neg { -n } else { n })
}

/// How a plain (non-formula) cell takes part in calculations: numeric text counts as a number.
fn plain(v: &V, german: bool) -> V {
    match v {
        V::Str(s) => to_number(s, german).or_else(|| if german { to_number(s, false) } else { None }).map(V::Num).unwrap_or_else(|| v.clone()),
        other => other.clone(),
    }
}

#[tauri::command]
pub fn engine_load(engine: State<Engine>, id: u64, rows: Vec<Vec<Value>>) {
    let table = rows.iter().map(|r| r.iter().map(from_json).collect()).collect();
    engine.0.lock().unwrap().insert(id, Table { rows: table, ..Default::default() });
}

/// Single cell edits: [row, col, value].
#[tauri::command]
pub fn engine_set(engine: State<Engine>, id: u64, changes: Vec<(usize, usize, Value)>) {
    let mut map = engine.0.lock().unwrap();
    let Some(Table { rows: t, .. }) = map.get_mut(&id) else { return };
    for (r, c, v) in changes {
        if r >= t.len() { t.resize(r + 1, Vec::new()); }
        let row = &mut t[r];
        if c >= row.len() { row.resize(c + 1, V::Empty); }
        row[c] = from_json(&v);
    }
}

#[tauri::command]
pub fn engine_drop(engine: State<Engine>, id: u64) {
    engine.0.lock().unwrap().remove(&id);
}

/// Results of all formula cells: [row, col, value]. `german`: per column, whether numbers are written "1.234,5".
/// `today`: today's date as Excel serial (local time comes from the UI).
pub fn calc_table(t: &[Vec<V>], german: &[bool], today: f64) -> Vec<(usize, usize, Value)> {
    let conv = |v: &V, c: usize| plain(v, german.get(c).copied().unwrap_or(false));
    let mut calc = Calc::new(t, &conv, today);
    let mut out = Vec::new();
    for (r, row) in t.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            if matches!(v, V::Str(s) if s.len() > 1 && s.starts_with('=')) {
                out.push((r, c, to_json(&calc.cell(r, c))));
            }
        }
    }
    out
}

/// Formula results as values (for the view) — same as calc_table but without JSON.
fn calc_values(t: &[Vec<V>], german: &[bool], today: f64) -> HashMap<(usize, usize), V> {
    let conv = |v: &V, c: usize| plain(v, german.get(c).copied().unwrap_or(false));
    let mut calc = Calc::new(t, &conv, today);
    let mut out = HashMap::new();
    for (r, row) in t.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            if is_formula(v) { out.insert((r, c), calc.cell(r, c)); }
        }
    }
    out
}

pub fn is_formula(v: &V) -> bool { matches!(v, V::Str(s) if s.len() > 1 && s.starts_with('=')) }

/// Everything the UI shows after a change: column types, formula results and the visible rows (search, filters,
/// sorting). Order matters: types of plain columns decide how numbers are read ("1.234,5"), formulas are calculated
/// with that, then columns with formulas get their type from the results.
#[tauri::command]
pub async fn engine_update(engine: State<'_, Engine>, id: u64, cols: usize, view: ViewReq, today: f64) -> Result<Value, String> {
    let mut map = engine.0.lock().unwrap();
    let table = map.get_mut(&id).ok_or("table not loaded")?;
    let t = &table.rows;
    let rows = t.len();
    let empty = V::Empty;
    let raw = |r: usize, c: usize| t[r].get(c).unwrap_or(&empty);
    let mut types: Vec<ColType> = (0..cols)
        .map(|c| detect(&sample(|i| { let v = raw(i, c); if is_formula(v) { &empty } else { v } }, rows)))
        .collect();
    let german: Vec<bool> = types.iter().map(|ty| ty.german).collect();
    let fv = calc_values(t, &german, today);
    let value = |r: usize, c: usize| -> &V { let v = raw(r, c); if is_formula(v) { fv.get(&(r, c)).unwrap_or(&empty) } else { v } };
    for c in 0..cols {
        if (0..rows).any(|r| is_formula(raw(r, c))) { types[c] = detect(&sample(|i| value(i, c), rows)); }
    }
    let visible = compute_view(rows, cols, &value, &types, &view);
    let values: Vec<(usize, usize, Value)> = fv.iter().map(|((r, c), v)| (*r, *c, to_json(v))).collect();
    let out = json!({"types": types, "values": values, "view": visible});
    (table.types, table.fv, table.view) = (types, fv, visible);
    Ok(out)
}

#[tauri::command]
pub async fn engine_calc(engine: State<'_, Engine>, id: u64, german: Vec<bool>, today: f64) -> Result<Vec<(usize, usize, Value)>, String> {
    let map = engine.0.lock().unwrap();
    let t = map.get(&id).ok_or("table not loaded")?;
    Ok(calc_table(&t.rows, &german, today))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn numbers_like_the_ui() {
        assert_eq!(to_number("1,234.5", false), Some(1234.5));
        assert_eq!(to_number("1.234,5", true), Some(1234.5));
        assert_eq!(to_number("12,5", true), Some(12.5));
        assert_eq!(to_number("12,5", false), None);
        assert_eq!(to_number("-3e2", false), Some(-300.0));
        assert_eq!(to_number(".5", false), Some(0.5));
        assert_eq!(to_number("1,23", false), None);
        assert_eq!(to_number("abc", false), None);
        assert_eq!(to_number("2024-01-05", false), None);
    }
    #[test]
    fn calc_with_german_column() {
        let t = vec![vec![V::Str("1.234,50".into()), V::Str("=A1*2".into())], vec![V::Str("12,5".into()), V::Str("=SUM(A1:A2)".into())]];
        let out = calc_table(&t, &[true, false], 45000.0);
        assert_eq!(out, vec![(0, 1, json!(2469.0)), (1, 1, json!(1247.0))]);
        let t2 = vec![vec![V::Date(45000.0), V::Str("=A1+1".into()), V::Str("=1/0".into())]];
        assert_eq!(calc_table(&t2, &[], 0.0), vec![(0, 1, json!(45001.0)), (0, 2, json!({"$e": "#DIV/0!"}))]);
    }
}
