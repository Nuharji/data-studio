/* Display of Excel formatting (reading and writing the files happens in Rust, see src-tauri/src/xlsx.rs).
   A style is the compact object the Rust side sends: {b, i, u, s, fc, fs, fn, bg, ha, va, wrap, bd: {t, r, b, l: [style, color]}, nf, date}.
   XFormat.css(style, dark)            -> inline CSS for a grid cell
   XFormat.number(value, code, locale) -> text in the cell's number format, or null for "General"
   XFormat.toSerial(date) / fromSerial(n) -> Excel date numbers */
(() => {
  'use strict';
  const lum = hex => { const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const fromSerial = n => { const d = new Date(Math.round((n - 25569) * 86400000)); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()); };
  const toSerial = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / 86400000 + 25569;

  /* ---------- Number formats ---------- */
  function sections(code) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '"') q = !q;
      if (ch === '\\' && !q) { cur += ch + (code[i + 1] || ''); i++; continue; }
      if (ch === ';' && !q) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  /* [Red], [>=100], [$-407] are dropped; [$€-407] becomes the text "€". */
  const cleanBrackets = s => s.replace(/\[\$([^\]-]*)(?:-[0-9A-Fa-f]+)?\]/g, (m, sym) => sym ? `"${sym}"` : '').replace(/\[[^\]]*\]/g, '');
  function isDateCode(s) {
    const x = s.replace(/"[^"]*"|\\./g, '').toLowerCase();
    return /[ydhsm]/.test(x) && !/[#?]/.test(x) && !/(^|[^.])0/.test(x) && x !== 'general';
  }
  function fmtDate(d, code, loc) {
    const s = code.replace(/"[^"]*"|\\./g, m => '\u0001' + encodeURIComponent(m[0] === '"' ? m.slice(1, -1) : m[1]) + '\u0002');
    const ampm = /AM\/PM|A\/P/i.test(s);
    const tokens = s.match(/\u0001[^\u0002]*\u0002|yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|A\/P|\.0+|./gi) || [];
    let out = '';
    tokens.forEach((tk, i) => {
      const low = tk.toLowerCase();
      const prev = tokens.slice(0, i).reverse().find(x => /^[hs]/i.test(x) || /^(d|y)/i.test(x));
      const next = tokens.slice(i + 1).find(x => /^[hsdy]/i.test(x));
      const minute = (low === 'm' || low === 'mm') && ((prev && /^h/i.test(prev)) || (next && /^s/i.test(next)));
      const H = d.getHours(), h12 = ampm ? (H % 12 || 12) : H;
      if (tk[0] === '\u0001') out += decodeURIComponent(tk.slice(1, -1));
      else if (low === 'yyyy') out += d.getFullYear();
      else if (low === 'yy') out += String(d.getFullYear()).slice(-2);
      else if (minute) out += low === 'mm' ? String(d.getMinutes()).padStart(2, '0') : d.getMinutes();
      else if (low === 'mmmmm') out += d.toLocaleString(loc, {month: 'narrow'});
      else if (low === 'mmmm') out += d.toLocaleString(loc, {month: 'long'});
      else if (low === 'mmm') out += d.toLocaleString(loc, {month: 'short'});
      else if (low === 'mm') out += String(d.getMonth() + 1).padStart(2, '0');
      else if (low === 'm') out += d.getMonth() + 1;
      else if (low === 'dddd') out += d.toLocaleString(loc, {weekday: 'long'});
      else if (low === 'ddd') out += d.toLocaleString(loc, {weekday: 'short'});
      else if (low === 'dd') out += String(d.getDate()).padStart(2, '0');
      else if (low === 'd') out += d.getDate();
      else if (low === 'hh') out += String(h12).padStart(2, '0');
      else if (low === 'h') out += h12;
      else if (low === 'ss') out += String(d.getSeconds()).padStart(2, '0');
      else if (low === 's') out += d.getSeconds();
      else if (low === 'am/pm') out += H < 12 ? 'AM' : 'PM';
      else if (low === 'a/p') out += H < 12 ? 'A' : 'P';
      else if (/^\.0+$/.test(tk)) out += '';
      else out += tk;
    });
    return out;
  }
  function fmtPlain(n, code, loc) {
    const lit = [];
    const s = code.replace(/"([^"]*)"|\\(.)|_.|\*./g, (m, q, e) => { if (m[0] === '_') return ' '; if (m[0] === '*') return ''; lit.push(q != null ? q : e); return '\u0001' + String.fromCharCode(0xE000 + lit.length - 1) + '\u0002'; });
    if (/[#0?]\s*\/\s*[#0?\d]/.test(s)) return null;   // fractions (# ?/?) are shown as plain numbers
    const pct = (s.match(/%/g) || []).length;
    if (pct) n *= Math.pow(100, pct);
    const m = /[#0?][#0?,]*(?:\.[#0?]*)?(?:E[+-][0-9]+)?|\.[#0?]+/i.exec(s);
    // Literal text is parked as private-use characters, so its digits can't be taken for number placeholders.
    const put = x => x.replace(/\u0001([\uE000-\uF8FF])\u0002/g, (y, ch) => lit[ch.charCodeAt(0) - 0xE000]);
    if (!m) return put(s);
    let ph = m[0], scale = 0;
    while (!ph.includes('.') && /,$/.test(ph)) { ph = ph.slice(0, -1); scale++; }   // "0," shows thousands
    n /= Math.pow(1000, scale);
    const [ip, dp = ''] = ph.split(/E/i)[0].split('.');
    const decimals = (dp.match(/[0?#]/g) || []).length, minDec = (dp.match(/0/g) || []).length;
    let text;
    if (/E[+-]/i.test(ph)) text = n.toExponential(decimals).toUpperCase().replace(/E\+?(-?)(\d+)$/, (x, sg, ex) => 'E' + (sg || '+') + ex.padStart(2, '0'));
    else text = n.toLocaleString(loc, {minimumFractionDigits: minDec, maximumFractionDigits: decimals, useGrouping: ip.includes(','),
      minimumIntegerDigits: Math.max(1, Math.min(21, (ip.replace(/,/g, '').match(/0/g) || []).length || 1))});
    if (!/0/.test(ip) && /#/.test(ip)) text = text.replace(/^(-?)0(?=[.,]\d)/, '$1');
    return put(s.slice(0, m.index) + text + s.slice(m.index + m[0].length));
  }
  function number(v, code, loc) {
    if (!code || /^general$/i.test(code) || code === '@') return null;
    const secs = sections(code);
    if (typeof v !== 'number' && !(v instanceof Date)) {
      if (secs[3] == null || typeof v !== 'string') return null;
      return cleanBrackets(secs[3]).replace(/"([^"]*)"/g, '$1').replace(/@/g, v);
    }
    let sec = secs[0], n = v;
    if (typeof v === 'number') {
      if (v < 0 && secs[1]) { sec = secs[1]; n = -v; }
      else if (v === 0 && secs[2]) sec = secs[2];
    }
    sec = cleanBrackets(sec);
    try {
      if (v instanceof Date) return fmtDate(v, isDateCode(sec) ? sec : 'yyyy-mm-dd', loc);
      if (isDateCode(sec)) return fmtDate(fromSerial(n), sec, loc);
      const r = fmtPlain(n, sec, loc);
      return r == null || (r.trim() === '' && n !== 0) ? null : r;
    } catch (e) { return null; }
  }

  /* ---------- Styles -> CSS ---------- */
  const W = {thin: 1, hair: 1, dotted: 1, dashed: 1, dashDot: 1, dashDotDot: 1, medium: 2, mediumDashed: 2, mediumDashDot: 2, mediumDashDotDot: 2, slantDashDot: 2, thick: 3, double: 3};
  const cache = new Map();
  function css(st, dark) {
    if (!st) return '';
    const key = (dark ? 'd' : 'l') + JSON.stringify(st), hit = cache.get(key);
    if (hit != null) return hit;
    const out = [];
    let bg = st.bg || null, fg = st.fc || null;
    if (bg && dark && bg === '#FFFFFF') bg = null;   // white fills only hide grid lines in Excel; in dark themes they'd glare
    if (bg) { out.push(`background:${bg}`); if (!fg) fg = lum(bg) > 0.5 ? '#000000' : '#FFFFFF'; }
    else if (fg && ((dark && lum(fg) < 0.25) || (!dark && lum(fg) > 0.85))) fg = null;   // keep text readable on the theme's background
    if (fg) out.push(`color:${fg}`);
    if (st.b) out.push('font-weight:700');
    if (st.i) out.push('font-style:italic');
    const deco = [st.u ? 'underline' : '', st.s ? 'line-through' : ''].filter(Boolean).join(' ');
    if (deco) out.push(`text-decoration:${deco}`);
    if (st.fs) out.push(`font-size:${(Math.max(8, Math.min(18, st.fs)) * 1.0909).toFixed(1)}px`);
    if (st.fn) out.push(`font-family:"${String(st.fn).replace(/"/g, '')}",var(--font-ui)`);
    if (st.ha === 'centerContinuous' || st.ha === 'center') out.push('text-align:center');
    else if (st.ha === 'left' || st.ha === 'right' || st.ha === 'justify') out.push(`text-align:${st.ha}`);
    if (st.wrap) out.push('white-space:normal;line-height:1.2;overflow-wrap:anywhere');
    const sh = [], bd = st.bd || {};
    const side = (s, x, y) => { if (!s) return; const w = W[s[0]] || 1, c = s[1] || (dark ? '#bbbbbb' : '#000000'); sh.push(`inset ${x * w}px ${y * w}px 0 0 ${c}`); };
    side(bd.t, 0, 1); side(bd.b, 0, -1); side(bd.l, 1, 0); side(bd.r, -1, 0);
    if (sh.length) out.push(`box-shadow:${sh.join(',')}`);
    const res = out.join(';');
    if (cache.size > 5000) cache.clear();
    cache.set(key, res);
    return res;
  }

  window.XFormat = {css, number, isDateCode, fromSerial, toSerial};
})();
