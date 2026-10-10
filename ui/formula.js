/* Formula text tools for Data Studio (calculation happens in Rust): references, row shifting, Excel form.
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

  /* Formulas are calculated in Rust (src-tauri/src/formula.rs). Kept here: the tokenizer and the reference tools
     below, which rewrite formulas when rows/columns move and when files are saved. */
  const ALIAS = {
    SUMME: 'SUM', MITTELWERT: 'AVERAGE', ANZAHL: 'COUNT', ANZAHL2: 'COUNTA', PRODUKT: 'PRODUCT', RUNDEN: 'ROUND',
    AUFRUNDEN: 'ROUNDUP', ABRUNDEN: 'ROUNDDOWN', GANZZAHL: 'INT', WURZEL: 'SQRT', POTENZ: 'POWER', REST: 'MOD',
    WENN: 'IF', WENNFEHLER: 'IFERROR', UND: 'AND', ODER: 'OR', NICHT: 'NOT', VERKETTEN: 'CONCAT', CONCATENATE: 'CONCAT',
    'LÄNGE': 'LEN', GROSS: 'UPPER', KLEIN: 'LOWER', GLÄTTEN: 'TRIM', LINKS: 'LEFT', RECHTS: 'RIGHT', HEUTE: 'TODAY',
    SUMMEWENN: 'SUMIF', ZÄHLENWENN: 'COUNTIF', MITTEL: 'AVERAGE', AVG: 'AVERAGE'
  };
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

  window.Formula = {error: err, isError: isErr, shiftRows, mapRefs, toExcel, cellName, colLetters, colIndex,
    isFormula: v => typeof v === 'string' && v.length > 1 && v[0] === '=', ERR};
})();
