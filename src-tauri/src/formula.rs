//! Spreadsheet formulas: "=SUM(A1:B3)*2", English and German function names, German style ("=RUNDEN(A1*1,5;2)":
//! ';' between arguments, ',' as decimal comma). A1 is the first data row. Same rules as Excel where it matters:
//! errors (#DIV/0!, #NAME?, #VALUE!, #REF!, #N/A) and #CYCLE! for circular references.

use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub enum V {
    Empty,
    Num(f64),
    Str(String),
    Bool(bool),
    /// Excel serial date (days since 1899-12-30)
    Date(f64),
    Err(&'static str),
    Arr(Vec<V>),
}

pub const DIV0: &str = "#DIV/0!";
pub const NAME: &str = "#NAME?";
pub const VALUE: &str = "#VALUE!";
pub const REF: &str = "#REF!";
pub const CYCLE: &str = "#CYCLE!";

type R<T> = Result<T, &'static str>;

/* ---------------- Tokens ---------------- */

#[derive(Clone, Debug)]
enum Tok {
    Num(f64),
    Str(String),
    Ref(usize, usize),
    Range((usize, usize), (usize, usize)),
    Name(String),
    Op(&'static str),
}

pub fn col_index(letters: &str) -> usize {
    letters.chars().fold(0usize, |n, ch| n * 26 + (ch.to_ascii_uppercase() as usize - 64)) - 1
}

/// German style: a ';' outside of quoted text.
fn is_german(src: &str) -> bool {
    let mut quoted = false;
    for ch in src.chars() {
        match ch {
            '"' => quoted = !quoted,
            ';' if !quoted => return true,
            _ => {}
        }
    }
    false
}

/// "$A$1" / "B12" at the start of `s`: (col, row, length) — not followed by letters, digits, '_' or '('.
fn cell_ref(s: &[char]) -> Option<(usize, usize, usize)> {
    let mut i = 0;
    if s.get(i) == Some(&'$') { i += 1; }
    let l0 = i;
    while i < s.len() && s[i].is_ascii_alphabetic() && i - l0 < 3 { i += 1; }
    if i == l0 || (i < s.len() && s[i].is_ascii_alphabetic()) { return None; }
    let letters: String = s[l0..i].iter().collect();
    if s.get(i) == Some(&'$') { i += 1; }
    let d0 = i;
    while i < s.len() && s[i].is_ascii_digit() { i += 1; }
    if i == d0 { return None; }
    let row: usize = s[d0..i].iter().collect::<String>().parse().ok()?;
    if row == 0 { return None; }
    Some((col_index(&letters), row - 1, i))
}

fn tokenize(src: &str) -> R<Vec<Tok>> {
    let german = is_german(src);
    let s: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    let after_ok = |j: usize| s.get(j).map_or(true, |c| !(c.is_ascii_alphanumeric() || *c == '_' || *c == '('));
    while i < s.len() {
        let ch = s[i];
        if ch.is_whitespace() { i += 1; continue; }
        let rest: String = s[i..s.len().min(i + 5)].iter().collect();
        if rest.starts_with("#REF!") { return Err(REF); }
        // number
        if ch.is_ascii_digit() {
            let mut j = i;
            while j < s.len() && s[j].is_ascii_digit() { j += 1; }
            let dec = if german { ',' } else { '.' };
            if j + 1 < s.len() && s[j] == dec && s[j + 1].is_ascii_digit() {
                j += 1;
                while j < s.len() && s[j].is_ascii_digit() { j += 1; }
            }
            if j < s.len() && (s[j] == 'e' || s[j] == 'E') {
                let mut k = j + 1;
                if k < s.len() && (s[k] == '+' || s[k] == '-') { k += 1; }
                if k < s.len() && s[k].is_ascii_digit() {
                    while k < s.len() && s[k].is_ascii_digit() { k += 1; }
                    j = k;
                }
            }
            let text: String = s[i..j].iter().collect::<String>().replace(',', ".");
            // A number directly followed by letters is something else (e.g. a name); refs never start with digits.
            out.push(Tok::Num(text.parse().map_err(|_| VALUE)?));
            i = j;
            continue;
        }
        if ch == '"' {
            let mut j = i + 1;
            let mut t = String::new();
            loop {
                if j >= s.len() { return Err(VALUE); }
                if s[j] == '"' {
                    if s.get(j + 1) == Some(&'"') { t.push('"'); j += 2; continue; }
                    break;
                }
                t.push(s[j]);
                j += 1;
            }
            out.push(Tok::Str(t));
            i = j + 1;
            continue;
        }
        if let Some((c, r, len)) = cell_ref(&s[i..]) {
            if s.get(i + len) == Some(&':') {
                if let Some((c2, r2, len2)) = cell_ref(&s[i + len + 1..]) {
                    if after_ok(i + len + 1 + len2) {
                        out.push(Tok::Range((r, c), (r2, c2)));
                        i += len + 1 + len2;
                        continue;
                    }
                }
            }
            if after_ok(i + len) {
                out.push(Tok::Ref(r, c));
                i += len;
                continue;
            }
        }
        let name_start = |c: char| c.is_ascii_alphabetic() || "ÄÖÜäöüß_".contains(c);
        if name_start(ch) {
            let mut j = i + 1;
            while j < s.len() && (s[j].is_ascii_alphanumeric() || "ÄÖÜäöüß_.".contains(s[j])) { j += 1; }
            out.push(Tok::Name(s[i..j].iter().collect::<String>().to_uppercase()));
            i = j;
            continue;
        }
        let two: String = s[i..s.len().min(i + 2)].iter().collect();
        if let Some(op) = ["<=", ">=", "<>"].iter().find(|o| two == **o) {
            out.push(Tok::Op(op));
            i += 2;
            continue;
        }
        if let Some(op) = ["-", "+", "*", "/", "^", "&", "%", "=", "<", ">", "(", ")"].iter().find(|o| o.starts_with(ch)) {
            out.push(Tok::Op(op));
            i += 1;
            continue;
        }
        if ch == ';' || (ch == ',' && !german) {
            out.push(Tok::Op(";"));
            i += 1;
            continue;
        }
        return Err(VALUE);
    }
    Ok(out)
}

/* ---------------- Parser ---------------- */

#[derive(Clone, Debug)]
pub enum Ast {
    Num(f64),
    Str(String),
    Bool(bool),
    Ref(usize, usize),
    Range((usize, usize), (usize, usize)),
    Neg(Box<Ast>),
    Pct(Box<Ast>),
    Call(String, Vec<Ast>),
    Bin(&'static str, Box<Ast>, Box<Ast>),
}

struct P {
    toks: Vec<Tok>,
    p: usize,
}

impl P {
    fn is_op(&self, ops: &[&str]) -> bool {
        matches!(self.toks.get(self.p), Some(Tok::Op(o)) if ops.contains(o))
    }
    fn expect(&mut self, op: &str) -> R<()> {
        if !self.is_op(&[op]) { return Err(VALUE); }
        self.p += 1;
        Ok(())
    }
    fn bin(&mut self, level: usize) -> R<Ast> {
        const LEVELS: [&[&str]; 5] = [&["=", "<>", "<", ">", "<=", ">="], &["&"], &["+", "-"], &["*", "/"], &["^"]];
        if level == 3 { return self.mul(); }
        if level == 4 { return self.power(); }
        let mut l = self.bin(level + 1)?;
        while self.is_op(LEVELS[level]) {
            let Tok::Op(op) = self.toks[self.p].clone() else { unreachable!() };
            self.p += 1;
            let r = self.bin(level + 1)?;
            l = Ast::Bin(op, Box::new(l), Box::new(r));
        }
        Ok(l)
    }
    fn mul(&mut self) -> R<Ast> {
        let mut l = self.unary()?;
        while self.is_op(&["*", "/"]) {
            let Tok::Op(op) = self.toks[self.p].clone() else { unreachable!() };
            self.p += 1;
            let r = self.unary()?;
            l = Ast::Bin(op, Box::new(l), Box::new(r));
        }
        Ok(l)
    }
    fn unary(&mut self) -> R<Ast> {
        if self.is_op(&["-", "+"]) {
            let neg = self.is_op(&["-"]);
            self.p += 1;
            let e = self.unary()?;
            return Ok(if neg { Ast::Neg(Box::new(e)) } else { e });
        }
        self.power()
    }
    fn power(&mut self) -> R<Ast> {
        let mut l = self.postfix()?;
        while self.is_op(&["^"]) {
            self.p += 1;
            let r = self.postfix()?;
            l = Ast::Bin("^", Box::new(l), Box::new(r));
        }
        Ok(l)
    }
    fn postfix(&mut self) -> R<Ast> {
        let mut e = self.primary()?;
        while self.is_op(&["%"]) {
            self.p += 1;
            e = Ast::Pct(Box::new(e));
        }
        Ok(e)
    }
    fn primary(&mut self) -> R<Ast> {
        let tk = self.toks.get(self.p).cloned().ok_or(VALUE)?;
        self.p += 1;
        Ok(match tk {
            Tok::Num(v) => Ast::Num(v),
            Tok::Str(s) => Ast::Str(s),
            Tok::Ref(r, c) => Ast::Ref(r, c),
            Tok::Range(a, b) => Ast::Range(a, b),
            Tok::Op("(") => {
                let e = self.bin(0)?;
                self.expect(")")?;
                e
            }
            Tok::Op(op @ ("-" | "+")) => {
                let e = self.power()?;
                if op == "-" { Ast::Neg(Box::new(e)) } else { e }
            }
            Tok::Name(n) => {
                if n == "TRUE" || n == "WAHR" { return Ok(Ast::Bool(true)); }
                if n == "FALSE" || n == "FALSCH" { return Ok(Ast::Bool(false)); }
                if !self.is_op(&["("]) { return Err(NAME); }
                self.p += 1;
                let mut args = Vec::new();
                if !self.is_op(&[")"]) {
                    loop {
                        args.push(self.bin(0)?);
                        if self.is_op(&[";"]) { self.p += 1; } else { break; }
                    }
                }
                self.expect(")")?;
                Ast::Call(n, args)
            }
            _ => return Err(VALUE),
        })
    }
}

pub fn parse(src: &str) -> R<Ast> {
    let mut p = P { toks: tokenize(src)?, p: 0 };
    let ast = p.bin(0)?;
    if p.p < p.toks.len() { return Err(VALUE); }
    Ok(ast)
}

/* ---------------- Values ---------------- */

fn to_num(v: &V) -> R<f64> {
    match v {
        V::Err(e) => Err(e),
        V::Num(n) | V::Date(n) => Ok(*n),
        V::Bool(b) => Ok(if *b { 1.0 } else { 0.0 }),
        V::Empty => Ok(0.0),
        V::Str(s) => {
            let t = s.trim().replacen(',', ".", 1);
            if t.is_empty() { return Ok(0.0); }
            match t.parse::<f64>() {
                Ok(n) if n.is_finite() && !t.to_ascii_lowercase().contains("inf") && !t.to_ascii_lowercase().contains("nan") => Ok(n),
                _ => Err(VALUE),
            }
        }
        V::Arr(a) => a.first().map_or(Ok(0.0), to_num),
    }
}

pub fn num_text(n: f64) -> String {
    if n == 0.0 { "0".into() } else { format!("{n}") }
}

fn to_str(v: &V) -> R<String> {
    Ok(match v {
        V::Err(e) => return Err(e),
        V::Empty => String::new(),
        V::Bool(b) => if *b { "TRUE".into() } else { "FALSE".into() },
        V::Num(n) | V::Date(n) => num_text(*n),
        V::Str(s) => s.clone(),
        V::Arr(a) => a.first().map_or(Ok(String::new()), to_str)?,
    })
}

fn to_bool(v: &V) -> R<bool> {
    Ok(match v {
        V::Err(e) => return Err(e),
        V::Bool(b) => *b,
        V::Num(n) | V::Date(n) => *n != 0.0,
        V::Empty => false,
        V::Arr(a) => return a.first().map_or(Ok(false), to_bool),
        V::Str(s) => match s.to_uppercase().as_str() {
            "TRUE" | "WAHR" => true,
            "FALSE" | "FALSCH" | "" => false,
            _ => return Err(VALUE),
        },
    })
}

fn flat(args: &[V], out: &mut Vec<V>) {
    for a in args {
        match a {
            V::Arr(x) => flat(x, out),
            other => out.push(other.clone()),
        }
    }
}
fn flatten(args: &[V]) -> Vec<V> { let mut o = Vec::new(); flat(args, &mut o); o }

/// Numbers in the arguments (text and empty cells are skipped like in Excel; errors propagate).
fn numbers(args: &[V]) -> R<Vec<f64>> {
    let mut out = Vec::new();
    for v in flatten(args) {
        match v {
            V::Err(e) => return Err(e),
            V::Num(n) | V::Date(n) => out.push(n),
            _ => {}
        }
    }
    Ok(out)
}

/// JavaScript's Math.round: halves go up.
fn js_round(x: f64) -> f64 { (x + 0.5).floor() }

pub(crate) fn alias(name: &str) -> &str {
    match name {
        "SUMME" => "SUM", "MITTELWERT" | "MITTEL" | "AVG" => "AVERAGE", "ANZAHL" => "COUNT", "ANZAHL2" => "COUNTA", "PRODUKT" => "PRODUCT",
        "RUNDEN" => "ROUND", "AUFRUNDEN" => "ROUNDUP", "ABRUNDEN" => "ROUNDDOWN", "GANZZAHL" => "INT", "WURZEL" => "SQRT", "POTENZ" => "POWER",
        "REST" => "MOD", "WENN" => "IF", "WENNFEHLER" => "IFERROR", "UND" => "AND", "ODER" => "OR", "NICHT" => "NOT", "VERKETTEN" | "CONCATENATE" => "CONCAT",
        "LÄNGE" => "LEN", "GROSS" => "UPPER", "KLEIN" => "LOWER", "GLÄTTEN" => "TRIM", "LINKS" => "LEFT", "RECHTS" => "RIGHT", "HEUTE" => "TODAY",
        "SUMMEWENN" => "SUMIF", "ZÄHLENWENN" => "COUNTIF",
        other => other,
    }
}

/// COUNTIF / SUMIF criteria: 5, ">3", "<>x", "=abc", "abc".
fn criterion(c: &V) -> R<Box<dyn Fn(&V) -> bool>> {
    if let V::Num(n) = c {
        let n = *n;
        return Ok(Box::new(move |v| matches!(v, V::Num(x) if *x == n)));
    }
    let s = to_str(c)?;
    let (op, raw) = ["<=", ">=", "<>", "<", ">", "="].iter().find(|o| s.starts_with(**o)).map(|o| (*o, s[o.len()..].to_string())).unwrap_or(("=", s.clone()));
    let num = raw.replacen(',', ".", 1).trim().parse::<f64>().ok().filter(|n| n.is_finite() && !raw.is_empty());
    let lower = raw.to_lowercase();
    Ok(Box::new(move |v| {
        if let (Some(x), V::Num(n)) = (num, v) {
            return match op { "=" => *n == x, "<>" => *n != x, "<" => *n < x, ">" => *n > x, "<=" => *n <= x, _ => *n >= x };
        }
        let t = to_str(v).unwrap_or_default().to_lowercase();
        match op { "<>" => t != lower, "=" => t == lower, _ => false }
    }))
}

pub(crate) fn call(name: &str, a: &[V], today: f64) -> R<V> {
    let arg = |i: usize| a.get(i).cloned().unwrap_or(V::Empty);
    let n = |i: usize| to_num(&arg(i));
    Ok(match name {
        "SUM" => V::Num(numbers(a)?.iter().sum()),
        "AVERAGE" => { let v = numbers(a)?; if v.is_empty() { return Err(DIV0); } V::Num(v.iter().sum::<f64>() / v.len() as f64) }
        "MIN" => { let v = numbers(a)?; V::Num(if v.is_empty() { 0.0 } else { v.iter().cloned().fold(f64::INFINITY, f64::min) }) }
        "MAX" => { let v = numbers(a)?; V::Num(if v.is_empty() { 0.0 } else { v.iter().cloned().fold(f64::NEG_INFINITY, f64::max) }) }
        "COUNT" => V::Num(numbers(a)?.len() as f64),
        "COUNTA" => V::Num(flatten(a).iter().filter(|v| !matches!(v, V::Empty) && !matches!(v, V::Str(s) if s.is_empty())).count() as f64),
        "PRODUCT" => V::Num(numbers(a)?.iter().product()),
        "ROUND" => { let f = 10f64.powf(if a.len() > 1 { n(1)? } else { 0.0 }); V::Num(js_round(n(0)? * f) / f) }
        "ROUNDUP" => { let f = 10f64.powf(if a.len() > 1 { n(1)? } else { 0.0 }); let v = n(0)?; V::Num(v.signum() * (v.abs() * f).ceil() / f * if v == 0.0 { 0.0 } else { 1.0 }) }
        "ROUNDDOWN" => { let f = 10f64.powf(if a.len() > 1 { n(1)? } else { 0.0 }); let v = n(0)?; V::Num(v.signum() * (v.abs() * f).floor() / f * if v == 0.0 { 0.0 } else { 1.0 }) }
        "INT" => V::Num(n(0)?.floor()),
        "ABS" => V::Num(n(0)?.abs()),
        "SQRT" => { let v = n(0)?; if v < 0.0 { return Err(VALUE); } V::Num(v.sqrt()) }
        "POWER" => V::Num(n(0)?.powf(n(1)?)),
        "MOD" => { let d = n(1)?; if d == 0.0 { return Err(DIV0); } let v = n(0)?; V::Num(v - d * (v / d).floor()) }
        "IF" => if to_bool(&arg(0))? { a.get(1).cloned().unwrap_or(V::Bool(true)) } else { a.get(2).cloned().unwrap_or(V::Bool(false)) },
        "IFERROR" => match arg(0) { V::Err(_) => arg(1), v => v },
        "AND" => { for v in flatten(a) { if !to_bool(&v)? { return Ok(V::Bool(false)); } } V::Bool(true) }
        "OR" => { for v in flatten(a) { if to_bool(&v)? { return Ok(V::Bool(true)); } } V::Bool(false) }
        "NOT" => V::Bool(!to_bool(&arg(0))?),
        "CONCAT" => V::Str(flatten(a).iter().map(to_str).collect::<R<Vec<_>>>()?.concat()),
        "LEN" => V::Num(to_str(&arg(0))?.chars().count() as f64),
        "UPPER" => V::Str(to_str(&arg(0))?.to_uppercase()),
        "LOWER" => V::Str(to_str(&arg(0))?.to_lowercase()),
        "TRIM" => V::Str(to_str(&arg(0))?.split_whitespace().collect::<Vec<_>>().join(" ")),
        "LEFT" => { let k = if a.len() > 1 { n(1)? } else { 1.0 }.max(0.0) as usize; V::Str(to_str(&arg(0))?.chars().take(k).collect()) }
        "RIGHT" => { let s: Vec<char> = to_str(&arg(0))?.chars().collect(); let k = (if a.len() > 1 { n(1)? } else { 1.0 }.max(0.0) as usize).min(s.len()); V::Str(s[s.len() - k..].iter().collect()) }
        "TODAY" => V::Num(today),
        "PI" => V::Num(std::f64::consts::PI),
        "SUMIF" => {
            let r = flatten(&[arg(0)]);
            let s = if a.len() > 2 { flatten(&[arg(2)]) } else { r.clone() };
            let test = criterion(&arg(1))?;
            V::Num(r.iter().enumerate().filter(|(_, v)| test(v)).filter_map(|(i, _)| match s.get(i) { Some(V::Num(x)) => Some(*x), _ => None }).sum())
        }
        "COUNTIF" => { let test = criterion(&arg(1))?; V::Num(flatten(&[arg(0)]).iter().filter(|v| test(v)).count() as f64) }
        _ => return Err(NAME),
    })
}

/* ---------------- Evaluation over a table ---------------- */

/// A table to calculate: raw cell values (formulas as "=…") and a conversion for plain cells
/// (text that looks like a number counts as a number, like before).
pub struct Calc<'a> {
    pub rows: &'a [Vec<V>],
    pub to_value: &'a dyn Fn(&V, usize) -> V,
    pub today: f64,
    cache: HashMap<(usize, usize), V>,
    asts: HashMap<String, R<Ast>>,
    active: std::collections::HashSet<(usize, usize)>,
}

impl<'a> Calc<'a> {
    pub fn new(rows: &'a [Vec<V>], to_value: &'a dyn Fn(&V, usize) -> V, today: f64) -> Self {
        Calc { rows, to_value, today, cache: HashMap::new(), asts: HashMap::new(), active: Default::default() }
    }
    fn cols(&self) -> usize { self.rows.iter().map(Vec::len).max().unwrap_or(0) }

    pub fn cell(&mut self, r: usize, c: usize) -> V {
        if r >= self.rows.len() || c >= self.cols() { return V::Err(REF); }
        let raw = self.rows[r].get(c).cloned().unwrap_or(V::Empty);
        if let V::Str(s) = &raw {
            if s.len() > 1 && s.starts_with('=') { return self.formula(r, c, s.clone()); }
        }
        (self.to_value)(&raw, c)
    }

    fn formula(&mut self, r: usize, c: usize, raw: String) -> V {
        if let Some(v) = self.cache.get(&(r, c)) { return v.clone(); }
        if self.active.contains(&(r, c)) { return V::Err(CYCLE); }
        self.active.insert((r, c));
        let ast = self.asts.entry(raw.clone()).or_insert_with(|| parse(&raw[1..])).clone();
        let mut v = match ast.and_then(|a| self.ev(&a)) {
            Ok(v) => v,
            Err(e) => V::Err(e),
        };
        if let V::Arr(a) = v { v = flatten(&a).into_iter().next().unwrap_or(V::Num(0.0)); }
        if let V::Num(n) = v { if !n.is_finite() { v = V::Err(DIV0); } }
        self.active.remove(&(r, c));
        self.cache.insert((r, c), v.clone());
        v
    }

    fn ev(&mut self, n: &Ast) -> R<V> {
        Ok(match n {
            Ast::Num(v) => V::Num(*v),
            Ast::Str(s) => V::Str(s.clone()),
            Ast::Bool(b) => V::Bool(*b),
            Ast::Ref(r, c) => self.cell(*r, *c),
            Ast::Range(a, b) => {
                let (r0, r1, c0, c1) = (a.0.min(b.0), a.0.max(b.0), a.1.min(b.1), a.1.max(b.1));
                let mut out = Vec::new();
                for r in r0..=r1.min(self.rows.len().saturating_sub(1)) {
                    if self.rows.is_empty() { break; }
                    for c in c0..=c1 { out.push(self.cell(r, c)); }
                }
                V::Arr(out)
            }
            Ast::Neg(e) => { let v = self.ev(e)?; V::Num(-to_num(&v)?) }
            Ast::Pct(e) => { let v = self.ev(e)?; V::Num(to_num(&v)? / 100.0) }
            Ast::Call(name, args) => {
                let name = alias(name).to_string();
                let aware = name == "IFERROR";
                let mut vals = Vec::new();
                for a in args {
                    match self.ev(a) {
                        Ok(v) => vals.push(v),
                        Err(e) if aware => vals.push(V::Err(e)),
                        Err(e) => return Err(e),
                    }
                }
                if !aware {
                    if let Some(V::Err(e)) = vals.iter().find(|v| matches!(v, V::Err(_))) { return Err(e); }
                }
                call(&name, &vals, self.today)?
            }
            Ast::Bin(op, l, r) => {
                let (l, r) = (self.ev(l)?, self.ev(r)?);
                match *op {
                    "+" => V::Num(to_num(&l)? + to_num(&r)?),
                    "-" => V::Num(to_num(&l)? - to_num(&r)?),
                    "*" => V::Num(to_num(&l)? * to_num(&r)?),
                    "/" => { let d = to_num(&r)?; if d == 0.0 { return Err(DIV0); } V::Num(to_num(&l)? / d) }
                    "^" => V::Num(to_num(&l)?.powf(to_num(&r)?)),
                    "&" => V::Str(to_str(&l)? + &to_str(&r)?),
                    _ => {
                        if let V::Err(e) = l { return Err(e); }
                        if let V::Err(e) = r { return Err(e); }
                        let ord = match (&l, &r) {
                            (V::Num(a), V::Num(b)) => a.partial_cmp(b),
                            _ => Some(to_str(&l)?.to_lowercase().cmp(&to_str(&r)?.to_lowercase())),
                        };
                        use std::cmp::Ordering::*;
                        V::Bool(match (*op, ord) {
                            ("=", Some(Equal)) => true,
                            ("<>", o) => o != Some(Equal),
                            ("<", Some(Less)) => true,
                            (">", Some(Greater)) => true,
                            ("<=", Some(Less | Equal)) => true,
                            (">=", Some(Greater | Equal)) => true,
                            _ => false,
                        })
                    }
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn s(x: &str) -> V { V::Str(x.into()) }
    fn n(x: f64) -> V { V::Num(x) }
    /// Same conversion as the UI's default: numeric text counts as a number.
    fn plain(v: &V, _c: usize) -> V {
        if let V::Str(t) = v { if let Ok(x) = t.trim().parse::<f64>() { return V::Num(x); } }
        v.clone()
    }
    fn eval(rows: Vec<Vec<V>>, r: usize, c: usize) -> V {
        let mut calc = Calc::new(&rows, &plain, 45000.0);
        calc.cell(r, c)
    }
    #[test]
    fn arithmetic_and_functions() {
        let rows = vec![
            vec![n(10.0), n(2.0), s("=A1*B1+1"), s("=SUM(A1:B2)"), s("=SUMME(A1;B1)*1,5")],
            vec![n(5.0), s("x"), s("=A2/0"), s("=IF(A1>5,\"hoch\",\"niedrig\")"), s("=WENN(A2>5;\"hoch\";\"niedrig\")")],
            vec![s("=Z9"), s("=ROUND(2.5)"), s("=ROUND(-2.5)"), s("=IFERROR(C2,\"x\")"), s("=COUNTIF(A1:A2,\">6\")")],
        ];
        assert_eq!(eval(rows.clone(), 0, 2), n(21.0));
        assert_eq!(eval(rows.clone(), 0, 3), n(17.0));
        assert_eq!(eval(rows.clone(), 0, 4), n(18.0));
        assert_eq!(eval(rows.clone(), 1, 2), V::Err(DIV0));
        assert_eq!(eval(rows.clone(), 1, 3), s("hoch"));
        assert_eq!(eval(rows.clone(), 1, 4), s("niedrig"));
        assert_eq!(eval(rows.clone(), 2, 0), V::Err(REF));
        assert_eq!(eval(rows.clone(), 2, 1), n(3.0));
        assert_eq!(eval(rows.clone(), 2, 2), n(-2.0));
        assert_eq!(eval(rows.clone(), 2, 3), s("x"));
        assert_eq!(eval(rows.clone(), 2, 4), n(1.0));
    }
    #[test]
    fn errors_and_cycles() {
        let rows = vec![vec![s("=B1"), s("=A1"), s("=FOO(1)"), s("=1+"), s("=\"a\"&TRUE&1.5"), s("=#REF!+1")]];
        assert_eq!(eval(rows.clone(), 0, 0), V::Err(CYCLE));
        assert_eq!(eval(rows.clone(), 0, 2), V::Err(NAME));
        assert_eq!(eval(rows.clone(), 0, 3), V::Err(VALUE));
        assert_eq!(eval(rows.clone(), 0, 4), s("aTRUE1.5"));
        assert_eq!(eval(rows.clone(), 0, 5), V::Err(REF));
    }
    #[test]
    fn text_functions_and_percent() {
        let rows = vec![vec![s("  Hallo   Welt "), s("=TRIM(A1)"), s("=LEN(B1)"), s("=UPPER(LEFT(B1;5))"), s("=50%*A2"), s("=RIGHT(\"Käse\",2)")], vec![n(80.0)]];
        assert_eq!(eval(rows.clone(), 0, 1), s("Hallo Welt"));
        assert_eq!(eval(rows.clone(), 0, 2), n(10.0));
        assert_eq!(eval(rows.clone(), 0, 3), s("HALLO"));
        assert_eq!(eval(rows.clone(), 0, 4), n(40.0));
        assert_eq!(eval(rows.clone(), 0, 5), s("se"));
    }
}
