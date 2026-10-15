//! Function plots for school math: f(x) terms like `x^2 - 2x + 1`, `sin(x)`, `2,5·e^(-x)` are parsed and sampled here;
//! zeros and turning points are found from the samples and refined. The UI only draws the points.
//!
//! Syntax: + − * / ^ (right-associative), brackets, |x|, implicit multiplication (`2x`, `3(x+1)`, `x sin(x)`),
//! decimal point or comma, the constants pi / π and e, and the functions sin cos tan asin acos atan sqrt √ abs ln log
//! (base 10) exp floor ceil round sgn. Angles in radians, or degrees when asked for.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq)]
enum Node {
    Num(f64),
    X,
    Neg(Box<Node>),
    Bin(char, Box<Node>, Box<Node>),
    Call(String, Box<Node>),
}

struct P<'a> { s: &'a [char], i: usize }

const FUNCS: &[&str] = &["asin", "acos", "atan", "sin", "cos", "tan", "sqrt", "abs", "ln", "log", "exp", "floor", "ceil", "round", "sgn"];

impl<'a> P<'a> {
    fn ws(&mut self) { while self.i < self.s.len() && self.s[self.i].is_whitespace() { self.i += 1; } }
    fn peek(&mut self) -> Option<char> { self.ws(); self.s.get(self.i).copied() }
    fn eat(&mut self, c: char) -> bool { if self.peek() == Some(c) { self.i += 1; true } else { false } }
    fn word(&self, w: &str) -> bool {
        let n = w.chars().count();
        self.i + n <= self.s.len() && self.s[self.i..self.i + n].iter().copied().eq(w.chars())
    }
    fn expr(&mut self) -> Result<Node, String> {
        let mut l = self.term()?;
        loop {
            let op = match self.peek() { Some('+') => '+', Some('-') | Some('−') => '-', _ => return Ok(l) };
            self.i += 1;
            l = Node::Bin(op, Box::new(l), Box::new(self.term()?));
        }
    }
    fn term(&mut self) -> Result<Node, String> {
        let mut l = self.unary()?;
        loop {
            let op = match self.peek() {
                Some('*') | Some('·') | Some('×') => { self.i += 1; '*' }
                Some('/') | Some(':') | Some('÷') => { self.i += 1; '/' }
                // Implicit multiplication: 2x, 3(x+1), x sin(x), (x+1)(x-1)
                Some(c) if c.is_alphanumeric() || c == '(' || c == 'π' || c == '√' => '*',
                _ => return Ok(l),
            };
            l = Node::Bin(op, Box::new(l), Box::new(self.unary()?));
        }
    }
    fn unary(&mut self) -> Result<Node, String> {
        if self.eat('-') || self.eat('−') { return Ok(Node::Neg(Box::new(self.unary()?))); }
        if self.eat('+') { return self.unary(); }
        self.power()
    }
    fn power(&mut self) -> Result<Node, String> {
        let base = self.atom()?;
        if self.eat('^') { return Ok(Node::Bin('^', Box::new(base), Box::new(self.unary()?))); }
        if self.eat('²') { return Ok(Node::Bin('^', Box::new(base), Box::new(Node::Num(2.0)))); }
        if self.eat('³') { return Ok(Node::Bin('^', Box::new(base), Box::new(Node::Num(3.0)))); }
        Ok(base)
    }
    fn atom(&mut self) -> Result<Node, String> {
        let Some(c) = self.peek() else { return Err("unexpected end".into()) };
        if c.is_ascii_digit() || c == '.' || c == ',' {
            let start = self.i;
            while self.i < self.s.len() && (self.s[self.i].is_ascii_digit() || ".,".contains(self.s[self.i])) { self.i += 1; }
            let t: String = self.s[start..self.i].iter().collect::<String>().replace(',', ".");
            return t.parse::<f64>().map(Node::Num).map_err(|_| format!("number “{t}”"));
        }
        if c == '(' { self.i += 1; let e = self.expr()?; if !self.eat(')') { return Err("missing )".into()); } return Ok(e); }
        if c == '|' { self.i += 1; let e = self.expr()?; if !self.eat('|') { return Err("missing |".into()); } return Ok(Node::Call("abs".into(), Box::new(e))); }
        if c == 'π' { self.i += 1; return Ok(Node::Num(std::f64::consts::PI)); }
        if c == '√' { self.i += 1; return Ok(Node::Call("sqrt".into(), Box::new(self.power()?))); }
        for f in FUNCS {
            if self.word(f) {
                self.i += f.len();
                // sin x  or  sin(x)
                let arg = if self.peek() == Some('(') { self.atom()? } else { self.power()? };
                return Ok(Node::Call(f.to_string(), Box::new(arg)));
            }
        }
        if self.word("pi") { self.i += 2; return Ok(Node::Num(std::f64::consts::PI)); }
        if c == 'x' || c == 'X' { self.i += 1; return Ok(Node::X); }
        if c == 'e' { self.i += 1; return Ok(Node::Num(std::f64::consts::E)); }
        Err(format!("“{c}” not understood"))
    }
}

fn parse(src: &str) -> Result<Node, String> {
    // "f(x) = …" and "y = …" are allowed in front.
    let body = match src.split_once('=') { Some((_, r)) => r, None => src };
    let chars: Vec<char> = body.trim().chars().collect();
    if chars.is_empty() { return Err("empty".into()); }
    let mut p = P { s: &chars, i: 0 };
    let n = p.expr()?;
    if p.peek().is_some() { return Err(format!("“{}” not understood", chars[p.i..].iter().collect::<String>())); }
    Ok(n)
}

fn eval(n: &Node, x: f64, deg: bool) -> f64 {
    let a = |m: f64| if deg { m.to_radians() } else { m };
    let b = |m: f64| if deg { m.to_degrees() } else { m };
    match n {
        Node::Num(v) => *v,
        Node::X => x,
        Node::Neg(e) => -eval(e, x, deg),
        Node::Bin(op, l, r) => {
            let (l, r) = (eval(l, x, deg), eval(r, x, deg));
            match op { '+' => l + r, '-' => l - r, '*' => l * r, '/' => l / r, _ => l.powf(r) }
        }
        Node::Call(f, e) => {
            let v = eval(e, x, deg);
            match f.as_str() {
                "sin" => a(v).sin(), "cos" => a(v).cos(), "tan" => a(v).tan(),
                "asin" => b(v.asin()), "acos" => b(v.acos()), "atan" => b(v.atan()),
                "sqrt" => v.sqrt(), "abs" => v.abs(), "ln" => v.ln(), "log" => v.log10(), "exp" => v.exp(),
                "floor" => v.floor(), "ceil" => v.ceil(), "round" => v.round(),
                _ => if v > 0.0 { 1.0 } else if v < 0.0 { -1.0 } else { 0.0 },
            }
        }
    }
}

#[derive(Serialize, Debug, Default)]
pub struct Plot {
    /// the term as written, or the error
    pub error: Option<String>,
    /// [x, y] samples; y is null where f is not defined (gaps, asymptotes)
    pub points: Vec<(f64, Option<f64>)>,
    pub zeros: Vec<f64>,
    /// [x, y, kind]: "max" or "min"
    pub extrema: Vec<(f64, f64, &'static str)>,
    /// f(0), when defined
    pub y0: Option<f64>,
}

fn round(v: f64) -> f64 { let r = (v * 1e6).round() / 1e6; if r == 0.0 { 0.0 } else { r } }

/// Bisection between a and b (f changes sign in between).
fn refine(f: &dyn Fn(f64) -> f64, mut a: f64, mut b: f64) -> f64 {
    let fa = f(a);
    for _ in 0..60 {
        let m = (a + b) / 2.0;
        if (f(m) > 0.0) == (fa > 0.0) { a = m } else { b = m }
    }
    (a + b) / 2.0
}

/// Golden-section search for a maximum (sign = 1) or minimum (sign = −1) between a and b.
fn golden(f: &dyn Fn(f64) -> f64, mut a: f64, mut b: f64, sign: f64) -> f64 {
    let g = (5f64.sqrt() - 1.0) / 2.0;
    for _ in 0..80 {
        let (c, d) = (b - g * (b - a), a + g * (b - a));
        if sign * f(c) > sign * f(d) { b = d } else { a = c }
    }
    (a + b) / 2.0
}

pub fn plot(src: &str, from: f64, to: f64, n: usize, deg: bool) -> Plot {
    let node = match parse(src) { Ok(n) => n, Err(e) => return Plot { error: Some(e), ..Default::default() } };
    let (from, to) = if from < to { (from, to) } else { (to, from) };
    let n = n.clamp(20, 5000);
    let f = |x: f64| eval(&node, x, deg);
    let span = to - from;
    let raw: Vec<(f64, f64)> = (0..=n).map(|i| { let x = from + span * i as f64 / n as f64; (x, f(x)) }).collect();
    // Huge values and jumps across an asymptote (tan, 1/x) are drawn as gaps.
    let ys: Vec<f64> = raw.iter().map(|p| p.1).filter(|y| y.is_finite()).collect();
    let mut sorted = ys.clone();
    sorted.sort_by(f64::total_cmp);
    let spread = if sorted.len() > 10 { crate::stats::quantile(&sorted, 0.95) - crate::stats::quantile(&sorted, 0.05) } else { f64::INFINITY };
    let limit = (spread * 50.0).max(1e3);
    let mut points: Vec<(f64, Option<f64>)> = raw.iter().map(|&(x, y)| (round(x), (y.is_finite() && y.abs() < 1e9).then_some(round(y)))).collect();
    for i in 1..points.len() {
        if let (Some(a), Some(b)) = (points[i - 1].1, points[i].1) {
            if (a - b).abs() > limit && a.signum() != b.signum() { points[i].1 = None; points[i - 1].1 = None; }
        }
    }
    let mut zeros = Vec::new();
    let mut extrema = Vec::new();
    let step = span / n as f64;
    for i in 0..raw.len() {
        let (x, y) = raw[i];
        if !y.is_finite() { continue; }
        if y == 0.0 { zeros.push(round(x)); continue; }
        if i + 1 < raw.len() {
            let (x2, y2) = raw[i + 1];
            if y2.is_finite() && y2 != 0.0 && (y > 0.0) != (y2 > 0.0) && points[i].1.is_some() && points[i + 1].1.is_some() {
                // A sign change is a zero only if f really gets close to 0 there; otherwise it is a pole (1/x),
                // which is drawn as a gap.
                let z = refine(&f, x, x2);
                if f(z).abs() < 1e-6 * spread.min(1e6).max(1.0) { zeros.push(round(z)); } else { points[i].1 = None; points[i + 1].1 = None; }
            }
        }
        if i > 0 && i + 1 < raw.len() {
            let (p, q) = (raw[i - 1].1, raw[i + 1].1);
            if p.is_finite() && q.is_finite() && points[i - 1].1.is_some() && points[i + 1].1.is_some() {
                let kind = if y > p && y >= q { Some(("max", 1.0)) } else if y < p && y <= q { Some(("min", -1.0)) } else { None };
                if let Some((k, sign)) = kind {
                    let xe = golden(&f, x - step, x + step, sign);
                    extrema.push((round(xe), round(f(xe)), k));
                }
            }
        }
    }
    zeros.dedup_by(|a, b| (*a - *b).abs() < step / 2.0);
    zeros.truncate(50);
    extrema.truncate(50);
    let y0 = (from <= 0.0 && to >= 0.0).then(|| f(0.0)).filter(|v| v.is_finite()).map(round);
    Plot { error: None, points, zeros, extrema, y0 }
}

/// Samples several terms over [from, to] (Chart panel → Function plot).
#[tauri::command]
pub fn plot_functions(exprs: Vec<String>, from: f64, to: f64, n: Option<usize>, deg: Option<bool>) -> Vec<Plot> {
    exprs.iter().map(|e| plot(e, from, to, n.unwrap_or(400), deg.unwrap_or(false))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn at(src: &str, x: f64) -> f64 { eval(&parse(src).unwrap(), x, false) }
    #[test]
    fn parsing() {
        assert_eq!(at("x^2 - 2x + 1", 3.0), 4.0);
        assert_eq!(at("f(x) = 2,5x", 2.0), 5.0);
        assert_eq!(at("-x^2", 3.0), -9.0);
        assert_eq!(at("2^3^2", 0.0), 512.0);
        assert_eq!(at("3(x+1)(x-1)", 2.0), 9.0);
        assert_eq!(at("|x - 5|", 2.0), 3.0);
        assert!((at("sin(pi/2) + cos 0", 0.0) - 2.0).abs() < 1e-12);
        assert!((at("x sin x", 1.0) - 1f64.sin()).abs() < 1e-12);
        assert!((at("√x + e", 4.0) - (2.0 + std::f64::consts::E)).abs() < 1e-12);
        assert_eq!(at("x²·3", 2.0), 12.0);
        assert!((at("exp(x)", 1.0) - std::f64::consts::E).abs() < 1e-12);
        assert_eq!(at("log(1000) + ln(e)", 0.0), 4.0);
        assert!(parse("2 +").is_err());
        assert!(parse("sin(x").is_err());
        assert!(parse("x # 2").is_err());
        assert!((eval(&parse("sin(x)").unwrap(), 90.0, true) - 1.0).abs() < 1e-12);
    }
    #[test]
    fn zeros_and_extrema() {
        let p = plot("x^2 - 4", -5.0, 5.0, 400, false);
        assert_eq!(p.zeros, vec![-2.0, 2.0]);
        assert_eq!(p.extrema, vec![(0.0, -4.0, "min")]);
        assert_eq!(p.y0, Some(-4.0));
        let c = plot("x^3 - 3x", -3.0, 3.0, 300, false);
        assert_eq!(c.extrema, vec![(-1.0, 2.0, "max"), (1.0, -2.0, "min")]);
        assert_eq!(c.zeros.len(), 3);
        assert!((c.zeros[0] + 3f64.sqrt()).abs() < 1e-5);
    }
    #[test]
    fn gaps_at_asymptotes() {
        let p = plot("1/x", -2.0, 2.0, 401, false);
        // No zero is reported across the pole, and the pole itself is a gap.
        assert!(p.zeros.is_empty(), "{:?}", p.zeros);
        assert!(p.points.iter().any(|q| q.1.is_none()));
        let t = plot("tan(x)", -3.0, 3.0, 600, false);
        assert_eq!(t.zeros, vec![0.0], "tan has its only zero in [-3, 3] at 0, none at the poles");
        assert!(t.points.iter().filter(|q| q.1.is_none()).count() >= 2);
    }
}
