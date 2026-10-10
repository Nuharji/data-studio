/* Spreadsheet formulas for Data Studio: "=SUM(A1:B3)*2", English and German function names.
   A1 is the first data row (the row numbers shown in the table), column A the first column.
   Formulas refer to the stored row order, so sorting or filtering the view doesn't change them (like Excel). */
(() => {
  'use strict';
  class FormulaError { constructor(code) { this.code = code; } toString() { return this.code; } }
  const ERR = {div0: '#DIV/0!', name: '#NAME?', value: '#VALUE!', ref: '#REF!', cycle: '#CYCLE!', na: '#N/A'};
  const err = code => new FormulaError(code);
  const isErr = v => v instanceof FormulaError;

  /* ---------- References ---------- */
  const colIndex = letters => { let n = 0; for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const colLetters = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const cellName = (r, c) => colLetters(c) + (r + 1);

  /* German style ("=RUNDEN(A1*1,5;2)"): ';' separates arguments and ',' is the decimal comma.
     Detected by a ';' outside of quoted text. */
  const isGerman = src => /;/.test(src.replace(/"(?:[^"]|"")*"/g, ''));

  /* ---------- Tokenizer ---------- */
  function tokenize(src) {
    const german = isGerman(src), numRe = german ? /^\d+(,\d+)?([eE][+-]?\d+)?/ : /^\d+(\.\d+)?([eE][+-]?\d+)?/;
    const out = []; let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      let m;
      const rest = src.slice(i);
      if (rest.startsWith('#REF!')) throw err(ERR.ref);   // a reference to a deleted row or column
      if ((m = numRe.exec(rest))) { out.push({t: 'num', v: parseFloat(m[0].replace(',', '.'))}); i += m[0].length; continue; }
      if (ch === '"') {
        let j = i + 1, s = '';
        while (j < src.length) { if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += src[j++]; }
        if (j >= src.length) throw err(ERR.value);
        out.push({t: 'str', v: s}); i = j + 1; continue;
      }
      if ((m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?(?![A-Za-z0-9_(])/.exec(rest))) {
        const a = {r: +m[2] - 1, c: colIndex(m[1])};
        out.push(m[3] ? {t: 'range', a, b: {r: +m[4] - 1, c: colIndex(m[3])}, raw: m[0]} : {t: 'ref', ...a, raw: m[0]});
        i += m[0].length; continue;
      }
      if ((m = /^[A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_.]*/.exec(rest))) { out.push({t: 'name', v: m[0].toUpperCase()}); i += m[0].length; continue; }
      if ((m = /^(<=|>=|<>|[-+*/^&%=<>()])/.exec(rest))) { out.push({t: 'op', v: m[0]}); i += m[0].length; continue; }
      // Argument separator: ';' always, ',' only in English-style formulas.
      if (ch === ';' || (ch === ',' && !german)) { out.push({t: 'op', v: ';'}); i++; continue; }
      throw err(ERR.value);
    }
    return out;
  }

  /* ---------- Parser (precedence climbing) -> AST ---------- */
  function parse(src) {
    const toks = tokenize(src); let p = 0;
    const peek = () => toks[p], next = () => toks[p++];
    const isOp = (...ops) => peek() && peek().t === 'op' && ops.includes(peek().v);
    const expect = v => { if (!isOp(v)) throw err(ERR.value); p++; };
    const bin = (sub, ops) => () => { let l = sub(); while (isOp(...ops)) { const op = next().v; l = {k: 'bin', op, l, r: sub()}; } return l; };
    const primary = () => {
      const tk = next();
      if (!tk) throw err(ERR.value);
      if (tk.t === 'num') return {k: 'num', v: tk.v};
      if (tk.t === 'str') return {k: 'str', v: tk.v};
      if (tk.t === 'ref') return {k: 'ref', r: tk.r, c: tk.c};
      if (tk.t === 'range') return {k: 'range', a: tk.a, b: tk.b};
      if (tk.t === 'op' && tk.v === '(') { const e = compare(); expect(')'); return e; }
      if (tk.t === 'op' && (tk.v === '-' || tk.v === '+')) { const e = power(); return tk.v === '-' ? {k: 'neg', e} : e; }
      if (tk.t === 'name') {
        if (tk.v === 'TRUE' || tk.v === 'WAHR') return {k: 'bool', v: true};
        if (tk.v === 'FALSE' || tk.v === 'FALSCH') return {k: 'bool', v: false};
        if (!isOp('(')) throw err(ERR.name);
        p++;
        const args = [];
        if (!isOp(')')) { do { args.push(compare()); } while (isOp(';') && next()); }
        expect(')');
        return {k: 'call', name: tk.v, args};
      }
      throw err(ERR.value);
    };
    const postfix = () => { let e = primary(); while (isOp('%')) { p++; e = {k: 'pct', e}; } return e; };
    const power = bin(postfix, ['^']);
    const unary = () => { if (isOp('-', '+')) { const op = next().v; const e = unary(); return op === '-' ? {k: 'neg', e} : e; } return power(); };
    const mul = bin(unary, ['*', '/']);
    const add = bin(mul, ['+', '-']);
    const concat = bin(add, ['&']);
    const compare = bin(concat, ['=', '<>', '<', '>', '<=', '>=']);
    const ast = compare();
    if (p < toks.length) throw err(ERR.value);
    return ast;
  }

  /* ---------- Values ---------- */
  const toNum = v => {
    if (isErr(v)) throw v;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v === '' || v == null) return 0;
    if (v instanceof Date) return v.getTime() / 86400000 + 25569;   // Excel serial date
    const n = Number(String(v).trim().replace(',', '.'));
    if (Number.isFinite(n)) return n;
    throw err(ERR.value);
  };
  const toStr = v => { if (isErr(v)) throw v; if (v == null) return ''; if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'; return String(v); };
  const toBool = v => { if (isErr(v)) throw v; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v !== 0; const s = String(v).toUpperCase(); if (s === 'TRUE' || s === 'WAHR') return true; if (s === 'FALSE' || s === 'FALSCH' || s === '') return false; throw err(ERR.value); };
  const flat = args => args.flat(Infinity);
  const numbers = args => flat(args).filter(v => { if (isErr(v)) throw v; return typeof v === 'number'; });

  /* Functions. Ranges arrive as arrays; text inside ranges is ignored by SUM etc., like in Excel. */
  const F = {
    SUM: a => numbers(a).reduce((s, x) => s + x, 0),
    AVERAGE: a => { const n = numbers(a); if (!n.length) throw err(ERR.div0); return n.reduce((s, x) => s + x, 0) / n.length; },
    MIN: a => { const n = numbers(a); return n.length ? Math.min(...n) : 0; },
    MAX: a => { const n = numbers(a); return n.length ? Math.max(...n) : 0; },
    COUNT: a => numbers(a).length,
    COUNTA: a => flat(a).filter(v => v !== '' && v != null).length,
    PRODUCT: a => numbers(a).reduce((s, x) => s * x, 1),
    ROUND: ([x, d = 0]) => { const f = 10 ** toNum(d); return Math.round(toNum(x) * f) / f; },
    ROUNDUP: ([x, d = 0]) => { const f = 10 ** toNum(d), v = toNum(x); return Math.sign(v) * Math.ceil(Math.abs(v) * f) / f; },
    ROUNDDOWN: ([x, d = 0]) => { const f = 10 ** toNum(d), v = toNum(x); return Math.sign(v) * Math.floor(Math.abs(v) * f) / f; },
    INT: ([x]) => Math.floor(toNum(x)),
    ABS: ([x]) => Math.abs(toNum(x)),
    SQRT: ([x]) => { const v = toNum(x); if (v < 0) throw err(ERR.value); return Math.sqrt(v); },
    POWER: ([x, y]) => toNum(x) ** toNum(y),
    MOD: ([x, y]) => { const d = toNum(y); if (!d) throw err(ERR.div0); const v = toNum(x); return v - d * Math.floor(v / d); },
    IF: ([c, a = true, b = false]) => toBool(c) ? a : b,
    IFERROR: ([v, alt]) => isErr(v) ? alt : v,
    AND: a => flat(a).every(toBool),
    OR: a => flat(a).some(toBool),
    NOT: ([x]) => !toBool(x),
    CONCAT: a => flat(a).map(toStr).join(''),
    LEN: ([x]) => toStr(x).length,
    UPPER: ([x]) => toStr(x).toUpperCase(),
    LOWER: ([x]) => toStr(x).toLowerCase(),
    TRIM: ([x]) => toStr(x).trim().replace(/\s+/g, ' '),
    LEFT: ([x, n = 1]) => toStr(x).slice(0, toNum(n)),
    RIGHT: ([x, n = 1]) => { const s = toStr(x); return s.slice(Math.max(0, s.length - toNum(n))); },
    TODAY: () => { const d = new Date(); return Math.floor(d.getTime() / 86400000 - d.getTimezoneOffset() / 1440) + 25569; },
    PI: () => Math.PI,
    SUMIF: ([range, crit, sumRange]) => {
      const r = [range].flat(Infinity), s = sumRange ? [sumRange].flat(Infinity) : r, test = criterion(crit);
      return r.reduce((acc, v, i) => test(v) && typeof s[i] === 'number' ? acc + s[i] : acc, 0);
    },
    COUNTIF: ([range, crit]) => { const test = criterion(crit); return [range].flat(Infinity).filter(test).length; }
  };
  const ALIAS = {
    SUMME: 'SUM', MITTELWERT: 'AVERAGE', ANZAHL: 'COUNT', ANZAHL2: 'COUNTA', PRODUKT: 'PRODUCT', RUNDEN: 'ROUND',
    AUFRUNDEN: 'ROUNDUP', ABRUNDEN: 'ROUNDDOWN', GANZZAHL: 'INT', WURZEL: 'SQRT', POTENZ: 'POWER', REST: 'MOD',
    WENN: 'IF', WENNFEHLER: 'IFERROR', UND: 'AND', ODER: 'OR', NICHT: 'NOT', VERKETTEN: 'CONCAT', CONCATENATE: 'CONCAT',
    'LÄNGE': 'LEN', GROSS: 'UPPER', KLEIN: 'LOWER', GLÄTTEN: 'TRIM', LINKS: 'LEFT', RECHTS: 'RIGHT', HEUTE: 'TODAY',
    SUMMEWENN: 'SUMIF', ZÄHLENWENN: 'COUNTIF', MITTEL: 'AVERAGE', AVG: 'AVERAGE'
  };
  // Functions that see errors in their arguments instead of failing on them.
  const ERROR_AWARE = new Set(['IFERROR']);
  function criterion(c) {
    if (typeof c === 'number') return v => v === c;
    const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(toStr(c)), op = m[1] || '=', raw = m[2];
    const num = Number(raw.replace(',', '.')), numeric = raw !== '' && Number.isFinite(num);
    return v => {
      if (numeric && typeof v === 'number') return op === '=' ? v === num : op === '<>' ? v !== num : op === '<' ? v < num : op === '>' ? v > num : op === '<=' ? v <= num : v >= num;
      const s = toStr(v).toLowerCase(), t = raw.toLowerCase();
      return op === '<>' ? s !== t : op === '=' ? s === t : false;
    };
  }

  /* ---------- Evaluation over a sheet ---------- */
  function makeEvaluator(getRaw, rowCount, colCount, toValue) {
    const cache = new Map(), astCache = new Map(), active = new Set();
    function cell(r, c) {
      if (r < 0 || c < 0 || r >= rowCount() || c >= colCount()) throw err(ERR.ref);
      const raw = getRaw(r, c);
      if (typeof raw === 'string' && raw.length > 1 && raw[0] === '=') return formulaAt(r, c, raw);
      return toValue(raw, c);
    }
    function formulaAt(r, c, raw) {
      const key = r + ':' + c;
      if (cache.has(key)) return cache.get(key);
      if (active.has(key)) return err(ERR.cycle);
      active.add(key);
      let v;
      try {
        let ast = astCache.get(raw);
        if (!ast) { ast = parse(raw.slice(1)); astCache.set(raw, ast); }
        v = ev(ast);
        if (Array.isArray(v)) v = v.flat(Infinity)[0] ?? 0;
        if (typeof v === 'number' && !Number.isFinite(v)) v = err(ERR.div0);
      } catch (e) { v = isErr(e) ? e : err(ERR.value); }
      active.delete(key); cache.set(key, v);
      return v;
    }
    function ev(n) {
      switch (n.k) {
        case 'num': case 'str': case 'bool': return n.v;
        case 'ref': return cell(n.r, n.c);
        case 'range': {
          const r0 = Math.min(n.a.r, n.b.r), r1 = Math.max(n.a.r, n.b.r), c0 = Math.min(n.a.c, n.b.c), c1 = Math.max(n.a.c, n.b.c);
          const out = [];
          for (let r = r0; r <= Math.min(r1, rowCount() - 1); r++) for (let c = c0; c <= c1; c++) out.push(cell(r, c));
          return out;
        }
        case 'neg': return -toNum(ev(n.e));
        case 'pct': return toNum(ev(n.e)) / 100;
        case 'call': {
          const name = ALIAS[n.name] || n.name, fn = F[name];
          if (!fn) throw err(ERR.name);
          const args = n.args.map(a => { try { return ev(a); } catch (e) { if (ERROR_AWARE.has(name) && isErr(e)) return e; throw e; } });
          if (!ERROR_AWARE.has(name)) for (const a of args) if (isErr(a)) throw a;
          return fn(args);
        }
        case 'bin': {
          const l = ev(n.l), r = ev(n.r);
          switch (n.op) {
            case '+': return toNum(l) + toNum(r);
            case '-': return toNum(l) - toNum(r);
            case '*': return toNum(l) * toNum(r);
            case '/': { const d = toNum(r); if (d === 0) throw err(ERR.div0); return toNum(l) / d; }
            case '^': return toNum(l) ** toNum(r);
            case '&': return toStr(l) + toStr(r);
            default: {
              if (isErr(l)) throw l; if (isErr(r)) throw r;
              const both = typeof l === 'number' && typeof r === 'number';
              const a = both ? l : toStr(l).toLowerCase(), b = both ? r : toStr(r).toLowerCase();
              return n.op === '=' ? a === b : n.op === '<>' ? a !== b : n.op === '<' ? a < b : n.op === '>' ? a > b : n.op === '<=' ? a <= b : a >= b;
            }
          }
        }
      }
      throw err(ERR.value);
    }
    return {value: cell, reset: () => cache.clear()};
  }

  /* Moves every cell reference by `rows` (used to convert between "A1 = first data row" and Excel rows,
     where row 1 holds the column names). Text in quotes is left alone. */
  function shiftRows(formula, rows) {
    return formula.split(/("(?:[^"]|"")*")/).map((part, i) => i % 2 ? part :
      part.replace(/(?<![A-Za-z0-9_.$])(\$?[A-Za-z]{1,3}\$?)(\d+)(?![A-Za-z0-9_(])/g, (m, col, row) => col + Math.max(1, +row + rows))).join('');
  }

  /* Rewrites every reference: fn(row, col) returns the new [row, col], or null when the cell is gone (#REF!).
     Used when rows or columns are inserted or deleted, so formulas keep pointing at the same data. */
  function mapRefs(formula, fn) {
    return formula.split(/("(?:[^"]|"")*")/).map((part, i) => i % 2 ? part :
      part.replace(/(?<![A-Za-z0-9_.$])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g, (m, d1, col, d2, row) => {
        const to = fn(+row - 1, colIndex(col));
        return to ? d1 + colLetters(to[1]) + d2 + (to[0] + 1) : '#REF!';
      })).join('');
  }

  /* The form spreadsheet files store: English function names, ',' between arguments, '.' as decimal point
     (Excel shows them in the user's language itself). "SUMME(A1;B1*1,5)" -> "SUM(A1,B1*1.5)". */
  const BOOL_EN = {WAHR: 'TRUE', FALSCH: 'FALSE'};
  function toExcel(formula) {
    let toks;
    try { toks = tokenize(formula); } catch (e) { return formula; }
    return toks.map((tk, k) => {
      switch (tk.t) {
        case 'num': return String(tk.v);
        case 'str': return '"' + tk.v.replace(/"/g, '""') + '"';
        case 'ref': case 'range': return tk.raw.toUpperCase();
        case 'name': { const call = toks[k + 1] && toks[k + 1].t === 'op' && toks[k + 1].v === '('; return call ? (ALIAS[tk.v] || tk.v) : (BOOL_EN[tk.v] || tk.v); }
        default: return tk.v === ';' ? ',' : tk.v;
      }
    }).join('');
  }

  window.Formula = {makeEvaluator, isError: isErr, shiftRows, mapRefs, toExcel, cellName, colLetters, colIndex,
    isFormula: v => typeof v === 'string' && v.length > 1 && v[0] === '=', ERR};
})();
