//! Column statistics (the "Column" panel) and chart data, worked out from what the table currently shows: formula
//! results, column types and the visible rows that the last `engine_update` computed. The UI only draws the result.
//!
//! Dates are handed out as Excel serials; the UI turns them into local dates.

use crate::engine::{to_number, Engine, Table};
use crate::formula::V;
use crate::view::{is_empty, parse_date, text_of, ColType, Kind};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

/// A number as the UI reads it from a number column: numbers, and text written in the column's style.
fn num_of(v: &V, ty: &ColType) -> Option<f64> {
    match v {
        V::Num(n) => Some(*n),
        V::Str(s) => to_number(s, ty.german),
        _ => None,
    }
}

/// A date as an Excel serial: dates, and text that reads as a date.
fn date_of(v: &V) -> Option<f64> {
    match v {
        V::Date(d) => Some(*d),
        V::Str(s) => parse_date(s),
        _ => None,
    }
}

/// Distinct texts in order of first appearance, with how often each occurs.
fn count_texts<'a>(values: impl Iterator<Item = &'a V>) -> Vec<(String, usize)> {
    let mut idx: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<(String, usize)> = Vec::new();
    for v in values {
        let k = text_of(v);
        match idx.get(&k) {
            Some(&i) => out[i].1 += 1,
            None => { idx.insert(k.clone(), out.len()); out.push((k, 1)); }
        }
    }
    out
}

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct NumStats { min: f64, max: f64, sum: f64, mean: f64, median: f64 }

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct ColStats {
    values: usize,
    empty: usize,
    unique: usize,
    number: Option<NumStats>,
    /// earliest and latest (Excel serials)
    dates: Option<(f64, f64)>,
    /// the most frequent values (only when some value repeats)
    top: Vec<(String, usize)>,
    shown: usize,
}

pub fn col_stats(t: &Table, c: usize) -> ColStats {
    let Some(ty) = t.types.get(c) else { return ColStats::default() };
    let vals: Vec<&V> = t.view.iter().map(|&r| t.value(r, c)).collect();
    let filled: Vec<&V> = vals.iter().copied().filter(|v| !is_empty(v) && !matches!(v, V::Err(_))).collect();
    let counts = count_texts(filled.iter().copied());
    let mut s = ColStats { values: filled.len(), empty: vals.len() - filled.len(), unique: counts.len(), shown: t.view.len(), ..Default::default() };
    match ty.kind {
        Kind::Number => {
            let mut ns: Vec<f64> = filled.iter().filter_map(|v| num_of(v, ty)).filter(|n| n.is_finite()).collect();
            if !ns.is_empty() {
                ns.sort_by(f64::total_cmp);
                let (sum, n, mid) = (ns.iter().sum::<f64>(), ns.len(), ns.len() / 2);
                let median = if n % 2 == 1 { ns[mid] } else { (ns[mid - 1] + ns[mid]) / 2.0 };
                s.number = Some(NumStats { min: ns[0], max: ns[n - 1], sum, mean: sum / n as f64, median });
            }
        }
        Kind::Date => {
            let ds = filled.iter().filter_map(|v| date_of(v));
            s.dates = ds.fold(None, |acc: Option<(f64, f64)>, d| Some(match acc { Some((a, b)) => (a.min(d), b.max(d)), None => (d, d) }));
        }
        _ => {}
    }
    if counts.len() < filled.len() {
        let mut top = counts;
        top.sort_by(|a, b| b.1.cmp(&a.1)); // stable: ties keep the order of first appearance
        top.truncate(8);
        s.top = top;
    }
    s
}

#[derive(Deserialize, Debug)]
pub struct ChartCfg {
    #[serde(rename = "type")]
    pub kind: String,
    pub x: usize,
    pub ys: Vec<usize>,
    pub agg: String,
    pub limit: usize,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(untagged)]
pub enum Point { Num(Option<f64>), Xy { x: f64, y: f64 } }

#[derive(Serialize, Debug, PartialEq)]
pub struct Dataset {
    /// the column shown (none: the row count)
    y: Option<usize>,
    data: Vec<Point>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct ChartData {
    scatter: bool,
    labels: Vec<String>,
    datasets: Vec<Dataset>,
}

pub fn chart_data(t: &Table, cfg: &ChartCfg) -> Option<ChartData> {
    let xty = t.types.get(cfg.x)?;
    let ys: Vec<usize> = cfg.ys.iter().copied().filter(|&y| y < t.types.len()).collect();
    let num = |r: usize, y: usize| num_of(t.value(r, y), &t.types[y]).filter(|n| n.is_finite());
    if cfg.kind == "scatter" {
        let y = *ys.first()?;
        let mut pts = Vec::new();
        for &r in &t.view {
            let xv = t.value(r, cfg.x);
            let x = if xty.kind == Kind::Date { date_of(xv) } else { num_of(xv, xty) };
            if let (Some(x), Some(y)) = (x.filter(|n| n.is_finite()), num(r, y)) { pts.push(Point::Xy { x, y }); }
            if pts.len() >= 5000 { break; }
        }
        return Some(ChartData { scatter: true, labels: vec![], datasets: vec![Dataset { y: Some(y), data: pts }] });
    }
    if cfg.agg == "count" {
        let mut entries = count_texts(t.view.iter().map(|&r| t.value(r, cfg.x)));
        if cfg.kind != "line" { entries.sort_by(|a, b| b.1.cmp(&a.1)); }
        entries.truncate(cfg.limit);
        let data = entries.iter().map(|e| Point::Num(Some(e.1 as f64))).collect();
        return Some(ChartData { scatter: false, labels: entries.into_iter().map(|e| e.0).collect(), datasets: vec![Dataset { y: None, data }] });
    }
    if ys.is_empty() { return None; }
    if cfg.agg == "none" {
        let part = &t.view[..t.view.len().min(cfg.limit)];
        return Some(ChartData {
            scatter: false,
            labels: part.iter().map(|&r| text_of(t.value(r, cfg.x))).collect(),
            datasets: ys.iter().map(|&y| Dataset { y: Some(y), data: part.iter().map(|&r| Point::Num(num(r, y))).collect() }).collect(),
        });
    }
    // Grouped by the x value: sum or average per group.
    let mut idx: HashMap<String, usize> = HashMap::new();
    let mut keys: Vec<String> = Vec::new();
    let mut groups: Vec<Vec<(f64, usize)>> = Vec::new();
    for &r in &t.view {
        let k = text_of(t.value(r, cfg.x));
        let g = match idx.get(&k) {
            Some(&i) => i,
            None => { idx.insert(k.clone(), keys.len()); keys.push(k); groups.push(vec![(0.0, 0); ys.len()]); keys.len() - 1 }
        };
        for (j, &y) in ys.iter().enumerate() {
            if let Some(n) = num(r, y) { groups[g][j].0 += n; groups[g][j].1 += 1; }
        }
    }
    let val = |g: usize, j: usize| -> Option<f64> {
        let (s, n) = groups[g][j];
        if cfg.agg == "avg" { if n > 0 { Some(s / n as f64) } else { None } } else { Some(s) }
    };
    let mut order: Vec<usize> = (0..keys.len()).collect();
    if matches!(xty.kind, Kind::Number | Kind::Date) {
        let key = |g: usize| {
            let k = &keys[g];
            if xty.kind == Kind::Date { parse_date(k) } else { to_number(k, xty.german) }.unwrap_or(0.0)
        };
        order.sort_by(|&a, &b| key(a).total_cmp(&key(b)));
        order.truncate(cfg.limit);
    } else if keys.len() > cfg.limit || cfg.kind != "line" {
        order.sort_by(|&a, &b| val(b, 0).unwrap_or(0.0).total_cmp(&val(a, 0).unwrap_or(0.0)));
        order.truncate(cfg.limit);
    }
    Some(ChartData {
        scatter: false,
        labels: order.iter().map(|&g| keys[g].clone()).collect(),
        datasets: ys.iter().enumerate().map(|(j, &y)| Dataset { y: Some(y), data: order.iter().map(|&g| Point::Num(val(g, j))).collect() }).collect(),
    })
}

#[tauri::command]
pub fn engine_col_stats(engine: State<Engine>, id: u64, col: usize) -> Option<ColStats> {
    engine.0.lock().unwrap().get(&id).map(|t| col_stats(t, col))
}

#[tauri::command]
pub fn engine_chart(engine: State<Engine>, id: u64, cfg: ChartCfg) -> Option<ChartData> {
    engine.0.lock().unwrap().get(&id).and_then(|t| chart_data(t, &cfg))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn table(rows: Vec<Vec<V>>, types: Vec<ColType>) -> Table {
        let view = (0..rows.len()).collect();
        Table { rows, types, view, ..Default::default() }
    }
    fn ty(kind: Kind, german: bool) -> ColType { ColType { kind, german } }
    fn s(x: &str) -> V { V::Str(x.into()) }

    #[test]
    fn column_statistics() {
        let t = table(vec![vec![s("a"), s("1,5")], vec![s("b"), s("2,5")], vec![s("a"), V::Empty], vec![s("a"), s("10")]],
            vec![ty(Kind::Text, false), ty(Kind::Number, true)]);
        let a = col_stats(&t, 0);
        assert_eq!((a.values, a.empty, a.unique, a.shown), (4, 0, 2, 4));
        assert_eq!(a.top, vec![("a".to_string(), 3), ("b".to_string(), 1)]);
        let b = col_stats(&t, 1);
        assert_eq!((b.values, b.empty), (3, 1));
        assert_eq!(b.number, Some(NumStats { min: 1.5, max: 10.0, sum: 14.0, mean: 14.0 / 3.0, median: 2.5 }));
        assert!(b.top.is_empty());
        let d = table(vec![vec![s("2024-05-01")], vec![V::Date(45000.0)]], vec![ty(Kind::Date, false)]);
        assert_eq!(col_stats(&d, 0).dates, Some((45000.0, 45413.0)));
    }

    #[test]
    fn chart_groups_and_counts() {
        let mut t = table(vec![vec![s("x"), V::Num(1.0)], vec![s("y"), V::Num(5.0)], vec![s("x"), V::Num(3.0)], vec![s("z"), s("n/a")]],
            vec![ty(Kind::Text, false), ty(Kind::Number, false)]);
        let cfg = |kind: &str, agg: &str, limit| ChartCfg { kind: kind.into(), x: 0, ys: vec![1], agg: agg.into(), limit };
        let sum = chart_data(&t, &cfg("bar", "sum", 30)).unwrap();
        assert_eq!(sum.labels, ["y", "x", "z"]);
        assert_eq!(sum.datasets[0].data, vec![Point::Num(Some(5.0)), Point::Num(Some(4.0)), Point::Num(Some(0.0))]);
        let avg = chart_data(&t, &cfg("line", "avg", 30)).unwrap();
        assert_eq!(avg.labels, ["x", "y", "z"]);
        assert_eq!(avg.datasets[0].data, vec![Point::Num(Some(2.0)), Point::Num(Some(5.0)), Point::Num(None)]);
        let count = chart_data(&t, &cfg("bar", "count", 2)).unwrap();
        assert_eq!((count.labels.clone(), count.datasets[0].y), (vec!["x".to_string(), "y".to_string()], None));
        let none = chart_data(&t, &cfg("bar", "none", 2)).unwrap();
        assert_eq!(none.labels, ["x", "y"]);
        t.view = vec![2, 0];
        let sc = chart_data(&t, &ChartCfg { kind: "scatter".into(), x: 1, ys: vec![1], agg: "sum".into(), limit: 30 }).unwrap();
        assert_eq!(sc.datasets[0].data, vec![Point::Xy { x: 3.0, y: 3.0 }, Point::Xy { x: 1.0, y: 1.0 }]);
        assert!(chart_data(&t, &ChartCfg { kind: "bar".into(), x: 0, ys: vec![], agg: "sum".into(), limit: 30 }).is_none());
    }

    #[test]
    fn numeric_x_is_sorted_by_value() {
        let t = table(vec![vec![s("10"), V::Num(1.0)], vec![s("2"), V::Num(2.0)], vec![s("1.5"), V::Num(3.0)]],
            vec![ty(Kind::Number, false), ty(Kind::Number, false)]);
        let d = chart_data(&t, &ChartCfg { kind: "bar".into(), x: 0, ys: vec![1], agg: "sum".into(), limit: 30 }).unwrap();
        assert_eq!(d.labels, ["1.5", "2", "10"]);
    }
}
