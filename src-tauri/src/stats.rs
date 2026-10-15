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
pub struct NumStats {
    min: f64, max: f64, sum: f64, mean: f64, median: f64,
    /// sample standard deviation and variance (n − 1), quartiles as Excel's QUARTILE.INC
    std: f64, var: f64, q1: f64, q3: f64,
}

/// The p-quantile of sorted numbers, interpolated like Excel's PERCENTILE.INC / QUARTILE.INC.
pub fn quantile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() { return f64::NAN; }
    let pos = (sorted.len() - 1) as f64 * p;
    let (i, f) = (pos.floor() as usize, pos.fract());
    if i + 1 < sorted.len() { sorted[i] + f * (sorted[i + 1] - sorted[i]) } else { sorted[i] }
}

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
                let mean = sum / n as f64;
                let var = if n > 1 { ns.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (n - 1) as f64 } else { 0.0 };
                s.number = Some(NumStats { min: ns[0], max: ns[n - 1], sum, mean, median, std: var.sqrt(), var, q1: quantile(&ns, 0.25), q3: quantile(&ns, 0.75) });
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
    /// scatter charts: add a linear trend line
    #[serde(default)]
    pub trend: bool,
}

/// A least-squares line y = a·x + b over the points, with R² (how well it fits) and the x range it covers.
#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
pub struct Trend { pub a: f64, pub b: f64, pub r2: f64, pub x0: f64, pub x1: f64 }

pub fn trend(pts: &[(f64, f64)]) -> Option<Trend> {
    let n = pts.len() as f64;
    if pts.len() < 2 { return None; }
    let (sx, sy) = pts.iter().fold((0.0, 0.0), |(a, b), (x, y)| (a + x, b + y));
    let (mx, my) = (sx / n, sy / n);
    let (sxx, sxy, syy) = pts.iter().fold((0.0, 0.0, 0.0), |(a, b, c), (x, y)| (a + (x - mx).powi(2), b + (x - mx) * (y - my), c + (y - my).powi(2)));
    if sxx == 0.0 { return None; }
    let a = sxy / sxx;
    let r2 = if syy == 0.0 { 1.0 } else { (sxy * sxy) / (sxx * syy) };
    let (x0, x1) = pts.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), (x, _)| (lo.min(*x), hi.max(*x)));
    Some(Trend { a, b: my - a * mx, r2, x0, x1 })
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
    #[serde(skip_serializing_if = "Option::is_none")]
    trend: Option<Trend>,
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
        let tr = if cfg.trend { trend(&pts.iter().filter_map(|p| match p { Point::Xy { x, y } => Some((*x, *y)), _ => None }).collect::<Vec<_>>()) } else { None };
        return Some(ChartData { scatter: true, trend: tr, labels: vec![], datasets: vec![Dataset { y: Some(y), data: pts }] });
    }
    if cfg.agg == "count" {
        let mut entries = count_texts(t.view.iter().map(|&r| t.value(r, cfg.x)));
        if cfg.kind != "line" { entries.sort_by(|a, b| b.1.cmp(&a.1)); }
        entries.truncate(cfg.limit);
        let data = entries.iter().map(|e| Point::Num(Some(e.1 as f64))).collect();
        return Some(ChartData { scatter: false, trend: None, labels: entries.into_iter().map(|e| e.0).collect(), datasets: vec![Dataset { y: None, data }] });
    }
    if ys.is_empty() { return None; }
    if cfg.agg == "none" {
        let part = &t.view[..t.view.len().min(cfg.limit)];
        return Some(ChartData {
            scatter: false,
            trend: None,
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
        trend: None,
        labels: order.iter().map(|&g| keys[g].clone()).collect(),
        datasets: ys.iter().enumerate().map(|(j, &y)| Dataset { y: Some(y), data: order.iter().map(|&g| Point::Num(val(g, j))).collect() }).collect(),
    })
}

/* ================= Pivot tables ================= */

#[derive(Deserialize, Debug)]
pub struct PivotCfg {
    /// column whose values become the rows
    pub rows: usize,
    /// column whose values become the columns (none: one value column)
    pub cols: Option<usize>,
    /// the numbers that are summarized (none: rows are counted)
    pub val: Option<usize>,
    /// "sum", "avg", "count", "min", "max"
    pub agg: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct PivotData {
    row_keys: Vec<String>,
    col_keys: Vec<String>,
    cells: Vec<Vec<Option<f64>>>,
    row_totals: Vec<Option<f64>>,
    col_totals: Vec<Option<f64>>,
    total: Option<f64>,
    /// row or column keys that were left out (more than the limits)
    cut: bool,
}

#[derive(Clone, Copy, Default)]
struct Acc { sum: f64, n: usize, rows: usize, min: f64, max: f64 }
impl Acc {
    fn add(&mut self, v: Option<f64>) {
        self.rows += 1;
        if let Some(v) = v {
            if self.n == 0 { self.min = v; self.max = v; } else { self.min = self.min.min(v); self.max = self.max.max(v); }
            self.sum += v; self.n += 1;
        }
    }
    fn get(&self, agg: &str, counting: bool) -> Option<f64> {
        match agg {
            "count" => Some(if counting { self.rows } else { self.n } as f64),
            _ if self.n == 0 => if self.rows > 0 && agg == "sum" { Some(0.0) } else { None },
            "avg" => Some(self.sum / self.n as f64),
            "min" => Some(self.min),
            "max" => Some(self.max),
            _ => Some(self.sum),
        }
    }
}

const PIVOT_ROWS: usize = 500;
const PIVOT_COLS: usize = 60;

/// Keys of a column in a sensible order: numbers and dates by value, text alphabetically (natural, ignoring case).
fn ordered_keys(t: &Table, c: usize) -> Vec<String> {
    let ty = &t.types[c];
    let mut keys: Vec<String> = Vec::new();
    let mut seen: HashMap<String, ()> = HashMap::new();
    for &r in &t.view {
        let k = text_of(t.value(r, c));
        if seen.insert(k.clone(), ()).is_none() { keys.push(k); }
    }
    let num = |k: &str| match ty.kind { Kind::Number => to_number(k, ty.german), Kind::Date => parse_date(k), _ => None };
    keys.sort_by(|a, b| match (a.is_empty(), b.is_empty()) {
        (true, false) => std::cmp::Ordering::Greater,
        (false, true) => std::cmp::Ordering::Less,
        _ => match (num(a), num(b)) {
            (Some(x), Some(y)) => x.total_cmp(&y),
            _ => crate::view::natural(&a.to_lowercase(), &b.to_lowercase()),
        },
    });
    keys
}

pub fn pivot(t: &Table, cfg: &PivotCfg) -> Option<PivotData> {
    if cfg.rows >= t.types.len() || cfg.cols.is_some_and(|c| c >= t.types.len()) || cfg.val.is_some_and(|v| v >= t.types.len()) { return None; }
    let counting = cfg.val.is_none();
    let agg = if counting { "count" } else { cfg.agg.as_str() };
    let mut row_keys = ordered_keys(t, cfg.rows);
    let mut col_keys = match cfg.cols { Some(c) => ordered_keys(t, c), None => vec![String::new()] };
    let cut = row_keys.len() > PIVOT_ROWS || col_keys.len() > PIVOT_COLS;
    row_keys.truncate(PIVOT_ROWS); col_keys.truncate(PIVOT_COLS);
    let ri: HashMap<&str, usize> = row_keys.iter().enumerate().map(|(i, k)| (k.as_str(), i)).collect();
    let ci: HashMap<&str, usize> = col_keys.iter().enumerate().map(|(i, k)| (k.as_str(), i)).collect();
    let mut cells = vec![vec![Acc::default(); col_keys.len()]; row_keys.len()];
    let (mut rows_t, mut cols_t, mut all) = (vec![Acc::default(); row_keys.len()], vec![Acc::default(); col_keys.len()], Acc::default());
    for &r in &t.view {
        let rk = text_of(t.value(r, cfg.rows));
        let ck = cfg.cols.map(|c| text_of(t.value(r, c))).unwrap_or_default();
        let v = cfg.val.and_then(|c| num_of(t.value(r, c), &t.types[c])).filter(|n| n.is_finite());
        all.add(v);
        let (Some(&i), Some(&j)) = (ri.get(rk.as_str()), ci.get(ck.as_str())) else { continue };
        cells[i][j].add(v); rows_t[i].add(v); cols_t[j].add(v);
    }
    Some(PivotData {
        cells: cells.iter().map(|row| row.iter().map(|a| if a.rows == 0 { None } else { a.get(agg, counting) }).collect()).collect(),
        row_totals: rows_t.iter().map(|a| a.get(agg, counting)).collect(),
        col_totals: cols_t.iter().map(|a| a.get(agg, counting)).collect(),
        total: all.get(agg, counting),
        row_keys, col_keys, cut,
    })
}

#[tauri::command]
pub fn engine_pivot(engine: State<Engine>, id: u64, cfg: PivotCfg) -> Option<PivotData> {
    engine.0.lock().unwrap().get(&id).and_then(|t| pivot(t, &cfg))
}

/// Spelling and grammar issues of the text cells (columns that read as text; not formulas, numbers or dates):
/// [row, column, text, issues] for each cell with issues (the text, so the UI only marks cells that still hold it).
/// Same texts are checked once.
#[tauri::command]
pub async fn engine_spell(app: tauri::AppHandle, engine: State<'_, Engine>, id: u64, lang: String, fallback: String) -> Result<Vec<(usize, usize, String, Vec<crate::spell::Issue>)>, String> {
    // Copy the texts out, so editing isn't blocked while checking.
    let cells: Vec<(usize, usize, String)> = {
        let map = engine.0.lock().unwrap();
        let t = map.get(&id).ok_or("table not loaded")?;
        let text_col = |c: usize| t.types.get(c).is_none_or(|ty| ty.kind == Kind::Text);
        t.rows.iter().enumerate().flat_map(|(r, row)| row.iter().enumerate().filter_map(move |(c, v)| match v {
            V::Str(s) if !s.starts_with('=') && s.len() <= 5000 => Some((r, c, s.clone())),
            _ => None,
        })).filter(|(_, c, _)| text_col(*c)).collect()
    };
    let mut checker = crate::spell::Checker::new(&app, &lang, &fallback);
    let mut seen: HashMap<String, Vec<crate::spell::Issue>> = HashMap::new();
    let mut out = Vec::new();
    for (r, c, s) in cells {
        let issues = match seen.get(&s) { Some(i) => i.clone(), None => { let i = checker.check(&s, &[(0, s.len())]); seen.insert(s.clone(), i.clone()); i } };
        if !issues.is_empty() {
            out.push((r, c, s, issues));
            if out.len() >= 20_000 { break; }
        }
    }
    Ok(out)
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
        let n = b.number.unwrap();
        assert_eq!((n.min, n.max, n.sum, n.mean, n.median), (1.5, 10.0, 14.0, 14.0 / 3.0, 2.5));
        assert!((n.var - 21.583333333333332).abs() < 1e-9 && (n.std - n.var.sqrt()).abs() < 1e-12);
        assert_eq!((n.q1, n.q3), (2.0, 6.25));
        assert!(b.top.is_empty());
        let d = table(vec![vec![s("2024-05-01")], vec![V::Date(45000.0)]], vec![ty(Kind::Date, false)]);
        assert_eq!(col_stats(&d, 0).dates, Some((45000.0, 45413.0)));
    }

    #[test]
    fn chart_groups_and_counts() {
        let mut t = table(vec![vec![s("x"), V::Num(1.0)], vec![s("y"), V::Num(5.0)], vec![s("x"), V::Num(3.0)], vec![s("z"), s("n/a")]],
            vec![ty(Kind::Text, false), ty(Kind::Number, false)]);
        let cfg = |kind: &str, agg: &str, limit| ChartCfg { kind: kind.into(), x: 0, ys: vec![1], agg: agg.into(), limit, trend: false };
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
        let sc = chart_data(&t, &ChartCfg { kind: "scatter".into(), x: 1, ys: vec![1], agg: "sum".into(), limit: 30, trend: false }).unwrap();
        assert_eq!(sc.datasets[0].data, vec![Point::Xy { x: 3.0, y: 3.0 }, Point::Xy { x: 1.0, y: 1.0 }]);
        assert!(chart_data(&t, &ChartCfg { kind: "bar".into(), x: 0, ys: vec![], agg: "sum".into(), limit: 30, trend: false }).is_none());
    }

    #[test]
    fn numeric_x_is_sorted_by_value() {
        let t = table(vec![vec![s("10"), V::Num(1.0)], vec![s("2"), V::Num(2.0)], vec![s("1.5"), V::Num(3.0)]],
            vec![ty(Kind::Number, false), ty(Kind::Number, false)]);
        let d = chart_data(&t, &ChartCfg { kind: "bar".into(), x: 0, ys: vec![1], agg: "sum".into(), limit: 30, trend: false }).unwrap();
        assert_eq!(d.labels, ["1.5", "2", "10"]);
    }

    #[test]
    fn trend_line() {
        let t = trend(&[(1.0, 3.0), (2.0, 5.0), (3.0, 7.0)]).unwrap();
        assert_eq!((t.a, t.b, t.r2, t.x0, t.x1), (2.0, 1.0, 1.0, 1.0, 3.0));
        assert!(trend(&[(1.0, 1.0)]).is_none());
        let w = trend(&[(0.0, 0.0), (1.0, 2.0), (2.0, 1.0), (3.0, 3.0)]).unwrap();
        assert!(w.r2 > 0.5 && w.r2 < 1.0);
    }
    #[test]
    fn pivot_tables() {
        let t = table(vec![
            vec![s("Nord"), s("2024"), s("10")], vec![s("Süd"), s("2024"), s("5")], vec![s("Nord"), s("2025"), s("7")],
            vec![s("Nord"), s("2024"), s("3")], vec![s(""), s("2025"), s("1")], vec![s("Süd"), s("2025"), s("x")],
        ], vec![ty(Kind::Text, false), ty(Kind::Number, false), ty(Kind::Number, false)]);
        let p = pivot(&t, &PivotCfg { rows: 0, cols: Some(1), val: Some(2), agg: "sum".into() }).unwrap();
        assert_eq!(p.row_keys, vec!["Nord", "Süd", ""]);
        assert_eq!(p.col_keys, vec!["2024", "2025"]);
        assert_eq!(p.cells, vec![vec![Some(13.0), Some(7.0)], vec![Some(5.0), Some(0.0)], vec![None, Some(1.0)]]);
        assert_eq!(p.row_totals, vec![Some(20.0), Some(5.0), Some(1.0)]);
        assert_eq!((p.col_totals.clone(), p.total), (vec![Some(18.0), Some(8.0)], Some(26.0)));
        let a = pivot(&t, &PivotCfg { rows: 0, cols: None, val: Some(2), agg: "avg".into() }).unwrap();
        assert_eq!(a.cells[0], vec![Some(20.0 / 3.0)]);
        let c = pivot(&t, &PivotCfg { rows: 1, cols: None, val: None, agg: "sum".into() }).unwrap();
        assert_eq!((c.cells, c.total), (vec![vec![Some(3.0)], vec![Some(3.0)]], Some(6.0)));
        let m = pivot(&t, &PivotCfg { rows: 0, cols: None, val: Some(2), agg: "max".into() }).unwrap();
        assert_eq!(m.row_totals, vec![Some(10.0), Some(5.0), Some(1.0)]);
        assert!(pivot(&t, &PivotCfg { rows: 9, cols: None, val: None, agg: "sum".into() }).is_none());
    }
}
