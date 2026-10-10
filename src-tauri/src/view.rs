//! Column types, search, column filters and sorting of a table — the rows the UI shows, in their order.
//! Same rules as before (they used to run in the UI):
//! - types: sampled (≤ 3000 values per column); number (English or German style), date, yes/no, text
//! - search: a row matches when any cell contains the text (case-insensitive)
//! - filters per column: "text" (contains), "=text" (exactly), "!…" (not), and for number/date columns
//!   ">5", "<=2024-01-01", "10..20"
//! - sorting: by the column's type; empty cells always last; ties keep the stored order.

use crate::engine::to_number;
use crate::formula::{num_text, V};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind { Text, Number, Date, Bool }

#[derive(Serialize, Clone, Debug)]
pub struct ColType {
    #[serde(rename = "type")]
    pub kind: Kind,
    pub german: bool,
}

#[derive(Deserialize, Default)]
pub struct ViewReq {
    #[serde(default)]
    pub query: String,
    /// [column, expression]
    #[serde(default)]
    pub filters: Vec<(usize, String)>,
    /// column and direction (1 ascending, -1 descending, 0 none)
    #[serde(default)]
    pub sort: Option<(usize, i32)>,
}

/* ---------- Dates ---------- */

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468
}

/// Excel serial (days since 1899-12-30) of "2024-05-01", "2024-05-01 14:30(:00)", "2024-05-01T14:30Z", "1.5.2024", "01.05.2024 14:30".
pub fn parse_date(s: &str) -> Option<f64> {
    let s = s.trim();
    let num = |t: &str| t.parse::<i64>().ok();
    let to_serial = |y: i64, m: i64, d: i64, h: i64, mi: i64, sec: f64| {
        if !(1..=12).contains(&m) || !(1..=31).contains(&d) || h > 23 || mi > 59 { return None; }
        Some((days_from_civil(y, m, d) + 25569) as f64 + (h as f64 * 3600.0 + mi as f64 * 60.0 + sec) / 86400.0)
    };
    let b = s.as_bytes();
    if b.len() >= 10 && b[4] == b'-' && b[7] == b'-' && s[..4].chars().all(|c| c.is_ascii_digit()) {
        let (y, m, d) = (num(&s[..4])?, num(&s[5..7])?, num(&s[8..10])?);
        if s.len() == 10 { return to_serial(y, m, d, 0, 0, 0.0); }
        let rest = &s[10..];
        if !rest.starts_with([' ', 'T']) || rest.len() < 6 { return None; }
        let t = &rest[1..];
        let (h, mi) = (num(t.get(0..2)?)?, num(t.get(3..5)?)?);
        if t.as_bytes().get(2) != Some(&b':') { return None; }
        let mut sec = 0.0;
        let mut tail = &t[5..];
        if let Some(r) = tail.strip_prefix(':') {
            let end = r.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap_or(r.len());
            sec = r[..end].parse().ok()?;
            tail = &r[end..];
        }
        if !(tail.is_empty() || tail == "Z" || (tail.len() >= 5 && tail.starts_with(['+', '-']))) { return None; }
        return to_serial(y, m, d, h, mi, sec);
    }
    let (date, time) = match s.split_once(' ') { Some((a, b)) => (a, Some(b)), None => (s, None) };
    let parts: Vec<&str> = date.split('.').collect();
    if parts.len() == 3 && parts[2].len() == 4 && parts[0].len() <= 2 && parts[1].len() <= 2 {
        let (d, m, y) = (num(parts[0])?, num(parts[1])?, num(parts[2])?);
        let (h, mi) = match time {
            Some(t) => { let (a, b) = t.split_once(':')?; if b.len() != 2 || a.len() > 2 { return None; } (num(a)?, num(b)?) }
            None => (0, 0),
        };
        return to_serial(y, m, d, h, mi, 0.0);
    }
    None
}

/// "2024-05-01" or "2024-05-01 14:30" from an Excel serial (the way the UI writes dates).
pub fn iso_date(serial: f64) -> String {
    let days = serial.floor() as i64 - 25569;
    let secs = ((serial - serial.floor()) * 86400.0).round() as i64;
    // civil_from_days
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    let day = format!("{y:04}-{m:02}-{d:02}");
    if secs > 0 { format!("{day} {:02}:{:02}", secs / 3600, (secs / 60) % 60) } else { day }
}

/* ---------- Values ---------- */

pub fn is_empty(v: &V) -> bool { matches!(v, V::Empty) || matches!(v, V::Str(s) if s.is_empty()) }

/// The text the UI shows for a value without formatting (used for search and filters).
pub fn text_of(v: &V) -> String {
    match v {
        V::Empty => String::new(),
        V::Str(s) => s.clone(),
        V::Num(n) => num_text(*n),
        V::Bool(b) => b.to_string(),
        V::Date(d) => iso_date(*d),
        V::Err(e) => e.to_string(),
        V::Arr(a) => a.first().map(text_of).unwrap_or_default(),
    }
}

fn is_bool_text(s: &str) -> bool {
    matches!(s.trim().to_lowercase().as_str(), "true" | "false" | "yes" | "no" | "ja" | "nein" | "wahr" | "falsch")
}

pub fn detect(values: &[&V]) -> ColType {
    let vals: Vec<&V> = values.iter().copied().filter(|v| !is_empty(v) && !matches!(v, V::Err(_))).collect();
    let t = |kind, german| ColType { kind, german };
    if vals.is_empty() { return t(Kind::Text, false); }
    if vals.iter().all(|v| matches!(v, V::Num(_))) { return t(Kind::Number, false); }
    if vals.iter().all(|v| matches!(v, V::Date(_))) { return t(Kind::Date, false); }
    if vals.iter().all(|v| matches!(v, V::Bool(_)) || matches!(v, V::Str(s) if is_bool_text(s))) { return t(Kind::Bool, false); }
    let strs = vals.iter().all(|v| matches!(v, V::Str(_) | V::Num(_)));
    let num_in = |german: bool| vals.iter().all(|v| match v { V::Num(_) => true, V::Str(s) => to_number(s, german).is_some(), _ => false });
    if strs && num_in(false) { return t(Kind::Number, false); }
    if strs && num_in(true) { return t(Kind::Number, true); }
    if vals.iter().all(|v| match v { V::Date(_) => true, V::Str(s) => parse_date(s).is_some(), _ => false }) { return t(Kind::Date, false); }
    t(Kind::Text, false)
}

/// Sampled values of a column (at most 3000, evenly spread), for type detection.
pub fn sample<'a>(col: impl Fn(usize) -> &'a V, rows: usize) -> Vec<&'a V> {
    let step = (rows / 3000).max(1);
    let mut out = Vec::new();
    let mut i = 0;
    while i < rows && out.len() < 3000 {
        out.push(col(i));
        i += step;
    }
    out
}

fn as_number(v: &V, ty: &ColType) -> Option<f64> {
    match v {
        V::Num(n) | V::Date(n) => Some(*n),
        V::Str(s) if ty.kind == Kind::Date => parse_date(s),
        V::Str(s) => to_number(s, ty.german),
        _ => None,
    }
}

/* ---------- Filters ---------- */

fn make_filter(expr: &str, ty: ColType) -> Box<dyn Fn(&V) -> bool> {
    let mut s = expr.trim().to_string();
    let neg = s.starts_with('!');
    if neg { s = s[1..].trim().to_string(); }
    let numeric = matches!(ty.kind, Kind::Number | Kind::Date);
    let parse = move |x: &str| -> Option<f64> {
        let x = x.trim();
        if ty.kind == Kind::Date { parse_date(x) } else { to_number(x, ty.german).or_else(|| to_number(x, false)) }
    };
    let ty2 = ty.clone();
    let test: Box<dyn Fn(&V) -> bool> = 'build: {
        if numeric {
            for op in [">=", "<=", ">", "<", "="] {
                if let Some(rest) = s.strip_prefix(op) {
                    if let Some(x) = parse(rest) {
                        let op = op.to_string();
                        let ty3 = ty2.clone();
                        break 'build Box::new(move |v| as_number(v, &ty3).is_some_and(|n| match op.as_str() { ">" => n > x, "<" => n < x, ">=" => n >= x, "<=" => n <= x, _ => n == x }));
                    }
                }
            }
            if let Some((a, b)) = s.split_once("..") {
                if let (Some(a), Some(b)) = (parse(a), parse(b)) {
                    let ty3 = ty2.clone();
                    break 'build Box::new(move |v| as_number(v, &ty3).is_some_and(|n| n >= a && n <= b));
                }
            }
        }
        if let Some(x) = s.strip_prefix('=') {
            let x = x.trim().to_lowercase();
            break 'build Box::new(move |v| text_of(v).to_lowercase() == x);
        }
        let x = s.to_lowercase();
        Box::new(move |v| text_of(v).to_lowercase().contains(&x))
    };
    Box::new(move |v| test(v) != neg)
}

/* ---------- Sorting ---------- */

#[derive(Debug)]
enum Key { Num(f64), Text(String) }

/// Base letters for comparison (ä → a, ß → ss …), lower case — like the UI's "base" sensitivity.
fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars().flat_map(char::to_lowercase) {
        match ch {
            'ä' | 'á' | 'à' | 'â' | 'ã' | 'å' => out.push('a'),
            'ö' | 'ó' | 'ò' | 'ô' | 'õ' | 'ø' => out.push('o'),
            'ü' | 'ú' | 'ù' | 'û' => out.push('u'),
            'é' | 'è' | 'ê' | 'ë' => out.push('e'),
            'í' | 'ì' | 'î' | 'ï' => out.push('i'),
            'ç' => out.push('c'),
            'ñ' => out.push('n'),
            'ß' => out.push_str("ss"),
            c => out.push(c),
        }
    }
    out
}

/// Natural order: "file2" before "file10". Expects already folded text (see `fold`).
fn natural(a: &str, b: &str) -> Ordering {
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(p), Some(q)) if p.is_ascii_digit() && q.is_ascii_digit() => {
                let mut na = String::new();
                while let Some(c) = x.peek().copied().filter(char::is_ascii_digit) { na.push(c); x.next(); }
                let mut nb = String::new();
                while let Some(c) = y.peek().copied().filter(char::is_ascii_digit) { nb.push(c); y.next(); }
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let o = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if o != Ordering::Equal { return o; }
            }
            (Some(p), Some(q)) => {
                if p != q { return p.cmp(&q); }
                x.next();
                y.next();
            }
        }
    }
}

fn sort_key(v: &V, ty: &ColType) -> Option<Key> {
    if is_empty(v) { return None; }
    Some(match ty.kind {
        Kind::Number | Kind::Date => match as_number(v, ty) { Some(n) => Key::Num(n), None => Key::Text(fold(&text_of(v))) },
        _ => Key::Text(fold(&text_of(v))),
    })
}

fn cmp_keys(a: &Key, b: &Key) -> Ordering {
    match (a, b) {
        (Key::Num(x), Key::Num(y)) => x.partial_cmp(y).unwrap_or(Ordering::Equal),
        (Key::Num(_), _) => Ordering::Less,
        (_, Key::Num(_)) => Ordering::Greater,
        (Key::Text(x), Key::Text(y)) => if x.bytes().any(|b| b.is_ascii_digit()) || y.bytes().any(|b| b.is_ascii_digit()) { natural(x, y) } else { x.cmp(y) },
    }
}

/// The rows to show (indexes into the stored rows). `value(r, c)` gives a cell's calculated value.
pub fn compute_view<'a>(rows: usize, cols: usize, value: &dyn Fn(usize, usize) -> &'a V, types: &[ColType], req: &ViewReq) -> Vec<usize> {
    let q = req.query.trim().to_lowercase();
    let filters: Vec<(usize, Box<dyn Fn(&V) -> bool>)> = req
        .filters
        .iter()
        .filter(|(c, e)| !e.trim().is_empty() && *c < cols)
        .map(|(c, e)| (*c, make_filter(e, types.get(*c).cloned().unwrap_or(ColType { kind: Kind::Text, german: false }))))
        .collect();
    let mut idx: Vec<usize> = (0..rows)
        .filter(|&i| q.is_empty() || (0..cols).any(|c| { let v = value(i, c); !is_empty(v) && text_of(v).to_lowercase().contains(&q) }))
        .filter(|&i| filters.iter().all(|(c, f)| f(value(i, *c))))
        .collect();
    if let Some((c, dir)) = req.sort {
        if dir != 0 && c < cols {
            let ty = types.get(c).cloned().unwrap_or(ColType { kind: Kind::Text, german: false });
            let keys: Vec<Option<Key>> = (0..rows).map(|i| if idx.binary_search(&i).is_ok() { sort_key(value(i, c), &ty) } else { None }).collect();
            idx.sort_by(|&a, &b| match (&keys[a], &keys[b]) {
                (None, None) => a.cmp(&b),
                (None, _) => Ordering::Greater,
                (_, None) => Ordering::Less,
                (Some(x), Some(y)) => { let o = cmp_keys(x, y); (if dir < 0 { o.reverse() } else { o }).then(a.cmp(&b)) }
            });
        }
    }
    idx
}

#[cfg(test)]
mod tests {
    use super::*;
    fn s(x: &str) -> V { V::Str(x.into()) }
    #[test]
    fn dates() {
        assert_eq!(parse_date("2024-05-01"), Some(45413.0));
        assert_eq!(parse_date("1.5.2024"), Some(45413.0));
        assert!(parse_date("01.05.2024 12:00").unwrap() - 45413.5 < 1e-9);
        assert_eq!(parse_date("2024-13-01"), None);
        assert_eq!(iso_date(45413.0), "2024-05-01");
        assert_eq!(iso_date(45413.5), "2024-05-01 12:00");
    }
    #[test]
    fn types() {
        assert_eq!(detect(&[&s("1,5"), &s("2,25"), &s("")]).kind, Kind::Number);
        assert!(detect(&[&s("1,5"), &s("2,25")]).german);
        assert!(!detect(&[&s("1,234.5"), &s("7")]).german);
        assert_eq!(detect(&[&s("2024-01-02"), &s("3.4.2024")]).kind, Kind::Date);
        assert_eq!(detect(&[&s("ja"), &s("nein")]).kind, Kind::Bool);
        assert_eq!(detect(&[&s("abc"), &V::Num(1.0)]).kind, Kind::Text);
    }
    #[test]
    fn filter_search_sort() {
        let data = vec![
            vec![s("Äpfel"), s("1.234,5"), s("2024-01-05")],
            vec![s("birne"), s("12,5"), s("")],
            vec![s("Datei10"), s("3"), s("2023-12-31")],
            vec![s("Datei2"), s(""), s("2024-02-01")],
        ];
        let types: Vec<ColType> = (0..3).map(|c| detect(&data.iter().map(|r| &r[c]).collect::<Vec<_>>())).collect();
        assert_eq!((types[1].kind, types[1].german, types[2].kind), (Kind::Number, true, Kind::Date));
        let value = |r: usize, c: usize| &data[r][c];
        let v = |req: ViewReq| compute_view(4, 3, &value, &types, &req);
        assert_eq!(v(ViewReq { query: "DATEI".into(), ..Default::default() }), vec![2, 3]);
        assert_eq!(v(ViewReq { filters: vec![(1, ">10".into())], ..Default::default() }), vec![0, 1]);
        assert_eq!(v(ViewReq { filters: vec![(1, "3..20".into())], ..Default::default() }), vec![1, 2]);
        assert_eq!(v(ViewReq { filters: vec![(0, "!datei".into())], ..Default::default() }), vec![0, 1]);
        assert_eq!(v(ViewReq { filters: vec![(2, "<2024-01-10".into())], ..Default::default() }), vec![0, 2]);
        assert_eq!(v(ViewReq { sort: Some((0, 1)), ..Default::default() }), vec![0, 1, 3, 2]);   // Äpfel, birne, Datei2, Datei10
        assert_eq!(v(ViewReq { sort: Some((1, -1)), ..Default::default() }), vec![0, 1, 2, 3]);  // 1234.5, 12.5, 3, (empty last)
        assert_eq!(v(ViewReq { sort: Some((2, 1)), ..Default::default() }), vec![2, 0, 3, 1]);
    }
}
