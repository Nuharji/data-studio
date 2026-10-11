'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const grid = $('#grid'), gInner = $('#gInner');
// Native backend (Rust/Tauri). Null when the UI is opened directly in a browser.
const invoke = window.__TAURI__ ? window.__TAURI__.core.invoke : null;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const STORE = 'data-studio.v1';
const HEAD_H = 30, FILT_H = 28;
const PALETTE = ['#12A06B', '#378EF0', '#E5384F', '#F08A1C', '#7B4DFF', '#22B8B0', '#C2410C', '#FF6B5A'];

/* ================= Translations ================= */
/* The texts (English / German) live in src-tauri/i18n/*.json and are loaded from Rust at start. */
let I18N = {en: {}, de: {}};
let lang = 'en';
function t(key, vars) {
  let s = I18N[lang][key] ?? I18N.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
  return s;
}
const fmtKey = k => lang === 'de' ? k.replace(/Ctrl/g, 'Strg').replace(/Shift/g, 'Umschalt').replace(/Delete/g, 'Entf')
  .replace(/ArrowUp/g, '↑').replace(/ArrowDown/g, '↓').replace(/Enter/g, 'Eingabe') : k.replace(/ArrowUp/g, '↑').replace(/ArrowDown/g, '↓');
const num = n => n.toLocaleString(lang, {maximumFractionDigits: 4});
const fmtSize = b => b >= 1048576 ? (b / 1048576).toLocaleString(lang, {maximumFractionDigits: 1}) + ' MB'
  : Math.max(1, Math.round(b / 1024)).toLocaleString(lang) + ' KB';

/* ================= Settings & state ================= */
const THEMES = ['dark', 'light', 'github', 'github-dark'];
const DEF = {lang: 'auto', theme: 'dark', dock: true, dockTab: 'column', reopen: true, compact: false, numLocal: false, filters: false, view: 'table'};
let settings = {...DEF}, recent = [], docs = [], active = -1, booted = false, docSeq = 0;
const cur = () => docs[active];
const sheet = () => cur() && cur().sheets[cur().si];
const effectiveLang = () => settings.lang === 'auto'
  ? ((navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en') : settings.lang;
function saveState() {
  try { localStorage.setItem(STORE, JSON.stringify({settings, recent, open: docs.filter(d => d.path).map(d => d.path), active: cur() && cur().path})); }
  catch (e) {}
}
function addRecent(path, name) {
  if (!path) return;
  recent = [{path, name}, ...recent.filter(r => r.path !== path)].slice(0, 10);
}

/* ================= Values: numbers, dates, display ================= */
const NUM_EN = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const NUM_DE = /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;
const isEmpty = v => v === null || v === undefined || v === '';
function toNumber(v, style = 'en') {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean' || v instanceof Date || typeof v !== 'string') return NaN;
  const s = v.trim();
  if (!s || s === '-' || s === '+' || s === '.') return NaN;
  if (style === 'de') return NUM_DE.test(s) ? +s.replace(/\./g, '').replace(',', '.') : NaN;
  return NUM_EN.test(s) ? +s.replace(/,/g, '') : NaN;
}
const pad2 = n => String(n).padStart(2, '0');
function isoDate(d) {
  const day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return d.getHours() || d.getMinutes() || d.getSeconds() ? `${day} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : day;
}
function rawText(v) {
  if (isEmpty(v)) return '';
  if (v instanceof Date) return isoDate(v);
  return String(v);
}
function display(v, col) {
  if (isEmpty(v)) return '';
  if (v instanceof Date) return settings.numLocal ? v.toLocaleDateString(lang) : isoDate(v);
  if (settings.numLocal && col.type === 'number') {
    const n = toNumber(v, col.numStyle);
    if (Number.isFinite(n)) return n.toLocaleString(lang, {maximumFractionDigits: 10});
  }
  const s = String(v);
  return s.length > 400 ? s.slice(0, 400) + '…' : s;
}

/* ---- Formulas (see formula.js). Cells starting with "=" are calculated; A1 = first data row. ---- */
function plainValue(raw, col) {
  if (isEmpty(raw)) return '';
  if (typeof raw === 'number' || typeof raw === 'boolean' || raw instanceof Date) return raw;
  for (const style of [col ? col.numStyle : 'en', 'en']) { const n = toNumber(raw, style); if (Number.isFinite(n)) return n; }
  return raw;
}
/* Formulas are calculated in Rust (engine.rs, formula.rs): every table is mirrored there, edits are passed on, and the
   results of all formula cells come back into sh.fv. Until the first result arrives a formula cell shows as empty. */
let engineSeq = 0;
const FK = (r, c) => r * 16384 + c;
const toEngine = v => v instanceof Date ? {$d: XFormat.toSerial(v)} : v == null ? '' : v;
const fromEngine = v => v && typeof v === 'object' ? ('$e' in v ? Formula.error(v.$e) : '$d' in v ? XFormat.fromSerial(v.$d) : v) : v;
function engineLoad(sh) {
  if (!invoke) return;
  sh.eid = sh.eid || ++engineSeq;
  sh.engineReady = invoke('engine_load', {id: sh.eid, rows: sh.rows.map(r => r.map(toEngine))});
}
/* Everything that depends on the data comes from Rust in one answer (engine.rs, view.rs): formula results, column
   types, and the visible rows (search, column filters, sorting). Only the newest answer for a sheet is applied;
   then the table is drawn again. */
async function engineUpdate(sh) {
  if (!invoke || !sh.eid) return;
  const my = sh.calcSeq = (sh.calcSeq || 0) + 1;
  await sh.engineReady;
  const now = new Date(), today = Math.floor(now.getTime() / 86400000 - now.getTimezoneOffset() / 1440) + 25569;
  const filters = Object.entries(sh.filters).filter(([, v]) => v && v.trim()).map(([c, v]) => [+c, v]);
  const res = await invoke('engine_update', {id: sh.eid, cols: sh.cols.length, today,
    view: {query: sh.query, filters, sort: sh.sort.dir ? [sh.sort.c, sh.sort.dir] : null}});
  if (my !== sh.calcSeq) return;
  sh.fv = new Map(res.values.map(([r, c, v]) => [FK(r, c), fromEngine(v)]));
  res.types.forEach((ty, c) => { const col = sh.cols[c]; if (col) { col.type = ty.type; col.numStyle = ty.german ? 'de' : 'en'; } });
  sh.view = res.view; clampSel(sh);
  if (sh === sheet()) { layoutCols(sh); renderGrid(); renderSheets(); buildPanels(); renderChart(); updateUI(); }
}
/* Until Rust answers, the view stays usable: all rows in stored order when nothing filters or sorts; otherwise the
   previous order (rows that no longer exist are dropped, new ones added at the end). */
function provisionalView(sh) {
  const n = sh.rows.length, active = sh.sort.dir || sh.query.trim() || Object.values(sh.filters).some(v => v && v.trim());
  if (!active || !sh.view) sh.view = Array.from({length: n}, (_, i) => i);
  else {
    const seen = new Set();
    sh.view = sh.view.filter(i => i < n && !seen.has(i) && seen.add(i));
    for (let i = 0; i < n; i++) if (!seen.has(i)) sh.view.push(i);
  }
  clampSel(sh);
}
function clampSel(sh) {
  const s = sh.sel, maxR = Math.max(0, sh.view.length - 1), maxC = Math.max(0, sh.cols.length - 1);
  s.ar = clamp(s.ar, 0, maxR); s.fr = clamp(s.fr, 0, maxR); s.ac = clamp(s.ac, 0, maxC); s.fc = clamp(s.fc, 0, maxC);
}
/* What a cell holds after calculation: formulas give their result, everything else is returned as stored. */
const cellValue = (sh, r, c) => { const raw = sh.rows[r][c]; return Formula.isFormula(raw) ? (sh.fv && sh.fv.has(FK(r, c)) ? sh.fv.get(FK(r, c)) : '') : raw; };
function displayCell(sh, r, c) {
  const raw = sh.rows[r][c], col = sh.cols[c];
  if (!Formula.isFormula(raw)) return display(raw, col);
  const v = cellValue(sh, r, c);
  if (Formula.isError(v)) return v.code;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (settings.numLocal) return v.toLocaleString(lang, {maximumFractionDigits: 10});
    const s = String(+v.toPrecision(15));
    return col.numStyle === 'de' ? s.replace('.', ',') : s;
  }
  return display(v, col);
}
/* ================= Excel formatting (see xformat.js for display, src-tauri/src/xlsx.rs for files) ================= */
const isDarkTheme = () => settings.theme === 'dark' || settings.theme === 'github-dark';
const FLAGS = ['b', 'i', 'u', 's', 'wrap'];
/* A cell's style reference: a style id from the file, or {base: id, set: {changes}} after editing. */
function styleOf(d, ref) {
  if (ref == null || !d) return null;
  const table = d.xstyles || [{}];
  if (typeof ref === 'number') return table[ref] || null;
  let st = {...(table[ref.base] || {})};
  for (const [k, v] of Object.entries(ref.set || {})) {
    if (k === 'clear') { st = {}; continue; }
    if (k === 'bd') { if (v === 'all') st.bd = {t: ['thin'], r: ['thin'], b: ['thin'], l: ['thin']}; else delete st.bd; continue; }
    if (k === 'nf') { if (v) { st.nf = v; st.date = XFormat.isDateCode(v) ? 1 : 0; } else { delete st.nf; delete st.date; } continue; }
    if (v == null || (FLAGS.includes(k) && !v)) delete st[k]; else st[k] = v;
  }
  return st;
}
const withSet = (ref, set) => {
  if (ref == null) return {base: 0, set: {...set}};
  if (typeof ref === 'number') return {base: ref, set: {...set}};
  return {base: ref.base, set: {...ref.set, ...set}};
};
/* Text shown in a cell: the cell's number format first (thousands separators, %, €, dates …), else the normal display. */
function shownCell(sh, i, c, st) {
  if (st && st.nf) {
    const v = cellValue(sh, i, c);
    if (typeof v === 'number' || v instanceof Date) { const f = XFormat.number(v, st.nf, lang === 'de' ? 'de-DE' : 'en-US'); if (f != null) return f; }
  }
  return displayCell(sh, i, c);
}
function mergeMaps(sh) {
  const anchors = new Map(), covered = new Set();
  for (const m of sh.merges) {
    if (m.r < 0) continue;
    anchors.set(m.r + ',' + m.c, m);
    for (let r = m.r; r < m.r + m.rs; r++) for (let c = m.c; c < m.c + m.cs; c++) if (r !== m.r || c !== m.c) covered.add(r + ',' + c);
  }
  return {anchors, covered};
}
function shiftFmtCols(sh, at, delta) {
  const shift = f => {
    if (!f) return f;
    const out = {};
    for (const [k, v] of Object.entries(f)) { const c = +k; if (delta < 0 && c === at) continue; out[c >= at ? c + delta : c] = v; }
    return out;
  };
  sh.rows.forEach(r => { if (r.fmt) r.fmt = shift(r.fmt); });
  if (sh.headFmt) sh.headFmt = shift(sh.headFmt);
}
/* Where merged areas end up after an operation: rows are followed by identity (row arrays), columns by position. */
function remapMerges(sh, op, before, rowsBefore) {
  const pos = new Map(sh.rows.map((r, i) => [r, i]));
  const newRow = r => r < 0 ? (op.t === 'header' ? (sh.header ? r : 0) : r) : (pos.has(rowsBefore[r]) ? pos.get(rowsBefore[r]) : (op.t === 'header' && sh.header && r === 0 ? -1 : null));
  const out = [];
  for (const m of before) {
    let c = m.c, cs = m.cs;
    if (op.t === 'col+') { if (op.at <= m.c) c++; else if (op.at < m.c + m.cs) cs++; }
    if (op.t === 'col-') { if (op.at < m.c) c--; else if (op.at < m.c + m.cs) { if (cs === 1) continue; cs--; } }
    const r0 = newRow(m.r), r1 = newRow(m.r + m.rs - 1);
    if (r0 == null || r1 == null || r1 < r0) continue;
    out.push({r: r0, c, rs: r1 - r0 + 1, cs});
  }
  return out;
}
const canFormat = () => { const d = cur(); return !!d && ['xlsx', 'xlsm'].includes(d.format) && !!invoke; };
function applyFormat(set) {
  const sh = sheet(); if (!sh || !canFormat()) return;
  stopEdit(true);
  const {r0, r1, c0, c1} = selRange(sh.sel), ch = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const i = sh.view[r], row = sh.rows[i]; if (!row) continue;
    const o = row.fmt ? row.fmt[c] : undefined;
    ch.push({r: i, c, o, n: set.clear ? undefined : withSet(o, set)});
  }
  if (ch.length) doOp({t: 'fmt', ch});
  syncFormatBar();
}
const focusStyle = () => { const sh = sheet(); if (!sh || !sh.view.length) return null; const row = sh.rows[sh.view[sh.sel.fr]]; return row && row.fmt ? styleOf(cur(), row.fmt[sh.sel.fc]) : null; };
const toggleFlag = k => () => { const st = focusStyle(); applyFormat({[k]: st && st[k] ? 0 : 1}); };
const NUM_FORMATS = ['General', '0', '0.00', '#,##0', '#,##0.00', '0%', '0.00%', '#,##0.00 "€"', '"$"#,##0.00', '0.00E+00', 'dd.mm.yyyy', 'yyyy-mm-dd', 'dd.mm.yyyy hh:mm', 'hh:mm', '@'];
function syncFormatBar() {
  const ok = canFormat(), st = focusStyle() || {};
  $$('#tools [data-act^="fmt"]').forEach(b => { b.disabled = !ok; b.title = tip(b.dataset.act) + (ok ? '' : ' — ' + t('ui.fmtOnlyExcel')); });
  for (const [a, k] of [['fmtBold', 'b'], ['fmtItalic', 'i'], ['fmtUnderline', 'u'], ['fmtWrap', 'wrap']]) $$(`[data-act="${a}"]`).forEach(b => b.classList.toggle('active', !!st[k]));
  for (const [a, v] of [['fmtAlignLeft', 'left'], ['fmtAlignCenter', 'center'], ['fmtAlignRight', 'right']]) $$(`[data-act="${a}"]`).forEach(b => b.classList.toggle('active', st.ha === v));
  if (!$('#fcBar')) return;
  $('#fcBar').style.background = st.fc || 'var(--text)'; $('#bgBar').style.background = st.bg || 'transparent';
}
/* Number formats: native menu with an example for each format; the current one is ticked. */
function numberFormatMenu() {
  if (!canFormat() || !invoke) return;
  const code = (focusStyle() || {}).nf || 'General';
  const list = NUM_FORMATS.includes(code) ? NUM_FORMATS : [...NUM_FORMATS, code];
  invoke('context_menu', {items: list.map((c, i) => ({id: 'nf:' + i, label: (NUM_FORMATS.includes(c) ? nfLabel(c) : t('nf.custom', {c})) + (c === 'General' || c === '@' ? '' : '   ·   ' + c), enabled: true, checked: c === code, accel: null}))}).catch(() => {});
  numberFormatMenu.list = list;
}
const nfLabel = code => code === 'General' ? t('nf.general') : code === '@' ? t('nf.text') : (XFormat.number(code.includes('y') || code.includes('h') ? new Date(2026, 9, 10, 14, 30) : code.includes('%') ? 0.255 : 1234.5, code, lang === 'de' ? 'de-DE' : 'en-US') || code);

/* ================= Reading files ================= */
const SHEET_EXT = ['xlsx', 'xlsm', 'xls', 'ods'], TEXT_EXT = ['csv', 'tsv', 'tab', 'txt', 'json', 'jsonl', 'ndjson'];
const extOf = name => (name.split('.').pop() || '').toLowerCase();
function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
/* excelRefs: formulas come from a spreadsheet file, where row 1 holds the column names — shift them so A1 is the first data row. */
function makeSheet(name, aoa, header = true, excelRefs = false) {
  const width = Math.min(4000, aoa.reduce((m, r) => Math.max(m, r.length), 0)) || 1;
  const fromExcel = v => excelRefs && header && Formula.isFormula(v) ? '=' + Formula.shiftRows(v.slice(1), -1) : v;
  const pad = r => { const out = r.slice(0, width); while (out.length < width) out.push(''); return out.map(v => v === null || v === undefined ? '' : fromExcel(v)); };
  let names, rows;
  if (header && aoa.length) { names = aoa[0].slice(0, width).map(rawText); while (names.length < width) names.push(''); rows = aoa.slice(1).map(pad); }
  else { names = []; rows = aoa.map(pad); }
  const seen = new Map();
  const cols = Array.from({length: width}, (_, i) => {
    let n = (names[i] || '').trim() || colName(i);
    if (seen.has(n)) { let k = 2; while (seen.has(`${n} (${k})`)) k++; n = `${n} (${k})`; }
    seen.set(n, 1);
    return {name: n, type: 'text', numStyle: 'en', width: 120};
  });
  const sh = {name, header, cols, rows, view: [], sort: {c: -1, dir: 0}, filters: {}, query: '',
    sel: {ar: 0, ac: 0, fr: 0, fc: 0}, scroll: {top: 0, left: 0}, chart: null};
  measureCols(sh); provisionalView(sh);
  engineLoad(sh); engineUpdate(sh);
  return sh;
}
/* Excel workbooks are read in Rust (xlsx.rs) with their formatting: values, formulas, a style table, merged cells,
   column widths and row heights. Cell styles hang on the row arrays (row.fmt[col]), so they move with sorting, inserting and deleting. */
async function parseXlsx(bytes, ext) {
  const m = await invoke('xlsx_read', bytes);
  const sheets = m.sheets.map(s => {
    const rows = Math.max(1, s.rows), cols = Math.max(1, s.cols);
    const aoa = Array.from({length: rows}, () => Array(cols).fill('')), fmt = [];
    for (const [r, c, kind, v, st] of s.cells) {
      if (r >= rows || c >= cols) continue;
      aoa[r][c] = kind === 'f' ? '=' + v : kind === 'd' ? XFormat.fromSerial(v) : v;
      if (st) (fmt[r] = fmt[r] || {})[c] = st;
    }
    const sh = makeSheet(s.name, aoa, true, true);
    // Empty header cells get a placeholder name (A, B, …) in the app, but stay empty in the file.
    sh.cols.forEach((col, c) => { if (!rawText(aoa[0][c]).trim()) col.autoName = true; });
    sh.headFmt = fmt[0] || {};
    sh.rows.forEach((row, i) => { if (fmt[i + 1]) row.fmt = fmt[i + 1]; });
    for (const [r, h] of s.heights) { if (r === 0) sh.headHt = h; else if (sh.rows[r - 1]) sh.rows[r - 1].ht = h; }
    for (const [c, w, hidden] of s.widths) if (sh.cols[c]) { sh.cols[c].xw = w; sh.cols[c].xhidden = hidden; }
    sh.merges = s.merges.map(([r, c, rs, cs]) => ({r: r - 1, c, rs, cs}));
    measureCols(sh);
    return sh;
  });
  return {format: ext, sheets, encoding: '', delimiter: '', bom: false, xtoken: m.token, xstyles: m.styles};
}
async function parseFile(bytes, name) {
  const ext = extOf(name), base = name.replace(/\.[^.]+$/, '');
  if ((ext === 'xlsx' || ext === 'xlsm') && invoke) return parseXlsx(bytes, ext);
  // CSV / TSV (separator detected), JSON, JSON Lines and old spreadsheets (.xls, .ods) are read in Rust (table.rs).
  const m = await invoke('table_read', bytes, {headers: {'x-name': encodeURIComponent(name)}});
  const fromRust = v => v && typeof v === 'object' && '$date' in v ? XFormat.fromSerial(v.$date) : v;
  const json = m.format === 'json' || m.format === 'jsonl';
  const sheets = m.sheets.map(s => makeSheet(s.name || base, s.rows.map(r => r.map(fromRust)), true, !json));
  return {format: m.format, sheets, encoding: m.encoding, bom: m.bom, delimiter: m.delimiter};
}

/* ================= File access (native or browser) ================= */
const enc = s => encodeURIComponent(s || '');
async function readPath(path) { return new Uint8Array(await invoke('read_file', {path})); }
async function writeBytes(bytes, {path = null, name, filter, ext}) {
  if (invoke) return invoke('save_binary', bytes, {headers: {'x-path': enc(path), 'x-name': enc(name), 'x-filter': enc(filter), 'x-ext': enc(ext)}});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes])); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  return {path: null, name};
}
async function pickFiles() {
  if (invoke) return invoke('pick_files', {filterName: lang === 'de' ? 'Datendateien' : 'Data files'});
  return new Promise(res => {
    const inp = $('#fileIn');
    inp.accept = [...TEXT_EXT, ...SHEET_EXT].map(e => '.' + e).join(',');
    inp.onchange = async () => {
      const out = [];
      for (const f of inp.files) out.push({name: f.name, size: f.size, path: null, bytes: new Uint8Array(await f.arrayBuffer())});
      inp.value = ''; res(out);
    };
    inp.click();
  });
}

/* ================= Documents & tabs ================= */
async function openFileInfo(f) {
  if (f.path) { const i = docs.findIndex(d => d.path === f.path); if (i >= 0) return activate(i); }
  if (![...TEXT_EXT, ...SHEET_EXT].includes(extOf(f.name))) return toast(t('toast.skipped', {name: f.name}));
  let bytes;
  try { bytes = f.bytes || await readPath(f.path); } catch (e) { return toast(t('toast.missing', {name: f.name})); }
  let parsed;
  try { parsed = await parseFile(bytes, f.name); } catch (e) { return toast(t('toast.openFail', {name: f.name, e: e.message || e})); }
  docs.push({id: ++docSeq, name: f.name, path: f.path || null, size: f.size || bytes.length, ...parsed, si: 0,
    dirty: false, history: [], future: [], cleanDepth: 0});
  addRecent(f.path, f.name);
  activate(docs.length - 1);
}
async function openFiles(list) { for (const f of list) await openFileInfo(f); }
let untitledN = 1;
/* New table: Excel workbook (keeps formulas), CSV (plain text) or JSON (list of records). */
function newTable() {
  const opt = (v, checked) => `<label><input type="radio" name="newfmt" value="${v}"${checked ? ' checked' : ''}><span>${esc(t('fmt.' + v))}<small>${esc(t('ui.new_' + v))}</small></span></label>`;
  modal(t('ui.newTitle'), `<div class="fmt-list">${opt('xlsx', true)}${opt('csv', false)}${opt('json', false)}</div>`, [
    {label: t('ui.cancel'), onClick: closeModal},
    {label: t('ui.create'), primary: true, onClick: () => { const f = $('input[name="newfmt"]:checked').value; closeModal(); createTable(f); }}
  ]);
}
function createTable(format) {
  const cols = 5, rows = Array.from({length: 20}, () => Array(cols).fill(''));
  const sh = makeSheet(format === 'xlsx' ? (lang === 'de' ? 'Tabelle1' : 'Sheet1') : t('ui.table2'), [Array.from({length: cols}, (_, i) => colName(i)), ...rows]);
  docs.push({id: ++docSeq, name: `${t('ui.untitled')}-${untitledN++}.${format}`, path: null, size: 0, format,
    delimiter: format === 'csv' ? ',' : '', bom: false, encoding: format === 'xlsx' ? '' : 'UTF-8',
    sheets: [sh], si: 0, dirty: false, history: [], future: [], cleanDepth: 0, isNew: true});
  activate(docs.length - 1);
}
function activate(i) {
  const prev = sheet();
  if (prev) prev.scroll = {top: grid.scrollTop, left: grid.scrollLeft};
  stopEdit(true);
  active = i;
  const d = cur();
  $('#emptyState').hidden = !!d; $('#work').hidden = !d;
  $('#globalSearch').value = d ? sheet().query : '';
  if (d) { refresh(); grid.scrollTop = sheet().scroll.top; grid.scrollLeft = sheet().scroll.left; renderGrid(); grid.focus({preventScroll: true}); }
  else { renderRecent(); updateUI(); buildPanels(); }
  renderTabs(); syncDisabled(); saveState();
}
async function closeTab(i) {
  const d = docs[i];
  if (d.dirty && !await ask(t('confirm.close', {name: d.name}), t('confirm.ok'))) return;
  if (invoke) d.sheets.forEach(s => { if (s.eid) invoke('engine_drop', {id: s.eid}).catch(() => {}); });
  if (d.xtoken && invoke) invoke('xlsx_forget', {token: d.xtoken}).catch(() => {});
  docs.splice(i, 1);
  let next = active;
  if (i < active) next--; else if (i === active) next = Math.min(active, docs.length - 1);
  active = -1;
  activate(next);
}
function renderTabs() {
  const box = $('#tabs'); box.innerHTML = '';
  docs.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'tab' + (i === active ? ' active' : '') + (d.dirty ? ' dirty' : '');
    el.title = (d.path || d.name) + (d.dirty ? ' — ' + t('ui.notSaved') : '');
    el.innerHTML = `<span class="tab-ico">${esc(d.format === 'jsonl' ? 'JSONL' : d.format)}</span><span class="name">${esc(d.name)}</span><button class="x" title="${esc(t('a.closeTab'))} (Alt+W)">&#10005;</button>`;
    el.onmousedown = e => { if (e.button === 1) { e.preventDefault(); closeTab(i); } };
    el.onclick = e => e.target.closest('.x') ? closeTab(i) : (i !== active && activate(i));
    box.append(el);
  });
  const plus = document.createElement('button');
  plus.className = 'tab-new'; plus.title = `${t('ui.openTip')} (Ctrl+O)`; plus.textContent = '+';
  plus.onclick = () => A.openFile();
  box.append(plus);
}
function renderRecent() {
  $('#recent').innerHTML = recent.length ? `<div class="sect">${esc(t('ui.recent'))}</div>` + recent.map((r, i) =>
    `<button data-recent="${i}"><span class="tab-ico">${esc(extOf(r.name))}</span><span>${esc(r.name)}</span><small>${esc(r.path)}</small></button>`).join('') : '';
}
$('#recent').addEventListener('click', e => {
  const b = e.target.closest('[data-recent]'); if (!b) return;
  const r = recent[+b.dataset.recent];
  openFileInfo({path: r.path, name: r.name}).then(() => { if (!docs.some(d => d.path === r.path)) { recent = recent.filter(x => x !== r); renderRecent(); saveState(); } });
});
function renderSheets() {
  const d = cur(), box = $('#sheets');
  box.hidden = !d || d.sheets.length < 2;
  if (box.hidden) return;
  box.innerHTML = d.sheets.map((s, i) => `<button data-sheet="${i}" class="${i === d.si ? 'active' : ''}">${esc(s.name)}</button>`).join('');
}
$('#sheets').addEventListener('click', e => {
  const b = e.target.closest('[data-sheet]'); if (!b) return;
  const d = cur(); sheet().scroll = {top: grid.scrollTop, left: grid.scrollLeft};
  stopEdit(true); d.si = +b.dataset.sheet;
  $('#globalSearch').value = sheet().query;
  refresh(); grid.scrollTop = sheet().scroll.top; grid.scrollLeft = sheet().scroll.left; renderGrid();
});

/* ================= Filtering & sorting ================= */

/* ================= Grid rendering (virtualized rows and columns) ================= */
let measureCtx = null;
function measureCols(sh) {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  measureCtx.font = '12px "Segoe UI", system-ui, sans-serif';
  const n = sh.rows.length, step = Math.max(1, Math.floor(n / 300));
  sh.cols.forEach((col, c) => {
    // Widths set in Excel (units ≈ characters) are kept.
    if (col.xw != null) { col.width = Math.round(clamp(col.xw * 7 + 5, 24, 1200)); return; }
    let w = measureCtx.measureText(col.name).width * 1.08 + 90;   // room for the type badge and sort button
    for (let i = 0; i < n; i += step) w = Math.max(w, measureCtx.measureText(rawText(sh.rows[i][c]).slice(0, 80)).width + 22);
    col.width = Math.round(clamp(w, 64, 380));
  });
}
const rowH = () => settings.compact ? 22 : 26;
const headH = () => HEAD_H + (settings.filters ? FILT_H : 0);
let layoutCache = null;
function layoutCols(sh) {
  const xs = []; let x = 0;
  sh.cols.forEach(c => { xs.push(x); x += c.width; });
  const numW = Math.max(48, String(sh.rows.length).length * 8 + 26);
  layoutCache = {xs, total: x, numW};
  grid.style.setProperty('--numw', numW + 'px');
  gInner.style.width = numW + x + 'px';
  gInner.style.height = headH() + sh.view.length * rowH() + 'px';
}
const ARROWS = {
  0: '<svg viewBox="0 0 24 24"><path d="M7 10l5-5 5 5M7 14l5 5 5-5"/></svg>',
  1: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  '-1': '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>'
};
function renderGrid() {
  const sh = sheet(); if (!sh || !layoutCache) return;
  const {xs, total, numW} = layoutCache, RH = rowH(), HH = headH(), s = sh.sel;
  const top = grid.scrollTop, left = grid.scrollLeft, h = grid.clientHeight, w = grid.clientWidth;
  const r0 = Math.max(0, Math.floor((top - HH) / RH) - 4), r1 = Math.min(sh.view.length, Math.ceil((top + h) / RH) + 4);
  let c0 = 0; while (c0 < sh.cols.length - 1 && xs[c0] + sh.cols[c0].width < left - numW - 150) c0++;
  let c1 = c0; while (c1 < sh.cols.length && xs[c1] < left + w + 150) c1++;
  const pad = `<div style="width:${xs[c0] || 0}px;flex:none"></div>`;
  const R0 = Math.min(s.ar, s.fr), R1 = Math.max(s.ar, s.fr), C0 = Math.min(s.ac, s.fc), C1 = Math.max(s.ac, s.fc);
  const focusEl = document.activeElement, fCol = focusEl && focusEl.dataset && focusEl.dataset.f, fPos = fCol != null ? focusEl.selectionStart : 0;
  const d = cur(), dark = isDarkTheme();
  // Merged cells are shown while the rows are in their original order (no sorting or filtering).
  const merged = sh.merges && sh.merges.length && sh.view.length === sh.rows.length && !sh.sort.dir && sh.view.every((v, i) => v === i) ? mergeMaps(sh) : null;
  let html = `<div class="g-head" style="width:${numW + total}px"><div class="g-hrow"><div class="g-corner"></div>${pad}`;
  for (let c = c0; c < c1; c++) {
    const col = sh.cols[c], sorted = sh.sort.c === c && sh.sort.dir;
    html += `<div class="g-th${c >= C0 && c <= C1 ? ' sel' : ''}" data-c="${c}" style="width:${col.width}px" title="${esc(col.name)} — ${esc(t('type.' + col.type))}">` +
      `<span class="tname">${esc(col.name)}</span><span class="ttype">${esc(t('tshort.' + col.type))}</span>` +
      `<button class="tsort${sorted ? ' on' : ''}" data-sort="${c}" title="${esc(t('ui.sortTip'))}">${ARROWS[sorted ? sh.sort.dir : 0]}</button>` +
      `<span class="resize" data-resize="${c}"></span></div>`;
  }
  html += '</div>';
  if (settings.filters) {
    html += `<div class="g-frow"><div class="g-corner"></div>${pad}`;
    for (let c = c0; c < c1; c++) {
      const v = sh.filters[c] || '';
      html += `<div class="g-fcell" style="width:${sh.cols[c].width}px"><input data-f="${c}" value="${esc(v)}" class="${v ? 'on' : ''}" placeholder="${esc(t('ui.filterPh'))}" title="${esc(t('ui.filterHelp'))}" spellcheck="false"></div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  for (let r = r0; r < r1; r++) {
    const row = sh.rows[sh.view[r]], rs = r >= R0 && r <= R1;
    html += `<div class="g-row" style="top:${HH + r * RH}px;width:${numW + total}px;background:var(${r % 2 ? '--grid-alt' : '--grid-bg'})">` +
      `<div class="g-num${rs ? ' sel' : ''}" data-r="${r}">${sh.view[r] + 1}</div>${pad}`;
    for (let c = c0; c < c1; c++) {
      const col = sh.cols[c], fx = Formula.isFormula(row[c]), st = row.fmt && row.fmt[c] != null ? styleOf(d, row.fmt[c]) : null;
      if (merged && merged.covered.has(r + ',' + c)) { html += `<div class="g-cell" style="width:${col.width}px;visibility:hidden"></div>`; continue; }
      const shown = shownCell(sh, sh.view[r], c, st);
      const bad = fx && /^#[A-Z/0!?]+$/.test(shown);
      const cls = 'g-cell' + (col.type === 'number' || (st && st.nf && !st.ha && typeof cellValue(sh, sh.view[r], c) === 'number') ? ' num' : '') + (fx ? ' fx' : '') + (bad ? ' err' : '') +
        (rs && c >= C0 && c <= C1 ? ' sel' : '') + (r === s.fr && c === s.fc ? ' focus' : '');
      let style = `width:${col.width}px` + (st ? ';' + XFormat.css(st, dark) : '');
      const mg = merged && merged.anchors.get(r + ',' + c);
      if (mg) {
        let w = 0; for (let k = c; k < c + mg.cs && k < sh.cols.length; k++) w += sh.cols[k].width;
        const jc = st && st.ha === 'center' || st && st.ha === 'centerContinuous' ? 'center' : st && st.ha === 'right' ? 'flex-end' : 'flex-start';
        const ai = st && st.va === 'top' ? 'flex-start' : st && st.va === 'center' ? 'center' : 'flex-end';
        style += `;width:${w}px;height:${mg.rs * RH}px;position:relative;z-index:1;display:flex;justify-content:${jc};align-items:${ai};background:${st && st.bg && !(dark && st.bg === '#FFFFFF') ? st.bg : `var(${r % 2 ? '--grid-alt' : '--grid-bg'})`}`;
      }
      html += `<div class="${cls}" data-r="${r}" data-c="${c}" style="${style}">${esc(shown)}</div>`;
    }
    html += '</div>';
  }
  if (!sh.view.length) html += `<div class="grid-empty" style="top:${HH + 40}px">${esc(t('ui.noRows'))}</div>`;
  gInner.innerHTML = html;
  if (fCol != null) { const inp = gInner.querySelector(`input[data-f="${fCol}"]`); if (inp) { inp.focus(); inp.setSelectionRange(fPos, fPos); } }
}
let gridRaf = 0;
grid.addEventListener('scroll', () => { if (!gridRaf) gridRaf = requestAnimationFrame(() => { gridRaf = 0; renderGrid(); }); });
window.addEventListener('resize', () => { renderGrid(); if (chart) chart.resize(); });

/* Full refresh of the current sheet (after data, layout or setting changes). */
function refresh(recalc = false) {
  const sh = sheet(); if (!sh) return;
  if (recalc) { provisionalView(sh); engineUpdate(sh); }
  layoutCols(sh); renderGrid(); renderSheets(); buildPanels(); renderChart(); updateUI();
}

/* ================= Selection & navigation ================= */
const selRange = s => ({r0: Math.min(s.ar, s.fr), r1: Math.max(s.ar, s.fr), c0: Math.min(s.ac, s.fc), c1: Math.max(s.ac, s.fc)});
function setSel(r, c, extend = false) {
  const sh = sheet(), s = sh.sel;
  r = clamp(r, 0, Math.max(0, sh.view.length - 1)); c = clamp(c, 0, sh.cols.length - 1);
  const colChanged = c !== s.fc;
  s.fr = r; s.fc = c;
  if (!extend) { s.ar = r; s.ac = c; }
  ensureVisible(r, c); renderGrid(); updateUI();
  if (colChanged || extend) buildColPanel();
}
function ensureVisible(r, c) {
  const {xs, numW} = layoutCache, sh = sheet(), RH = rowH(), HH = headH();
  const y = HH + r * RH;
  if (y < grid.scrollTop + HH) grid.scrollTop = y - HH;
  else if (y + RH > grid.scrollTop + grid.clientHeight) grid.scrollTop = y + RH - grid.clientHeight;
  const x = xs[c], w = sh.cols[c].width;
  if (x < grid.scrollLeft) grid.scrollLeft = x;
  else if (numW + x + w > grid.scrollLeft + grid.clientWidth) grid.scrollLeft = numW + x + w - grid.clientWidth;
}
let dragSel = false;
gInner.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const sh = sheet(); if (!sh) return;
  const cell = e.target.closest('.g-cell'), rnum = e.target.closest('.g-num'), th = e.target.closest('.g-th');
  if (e.target.closest('[data-resize]')) return startResize(e, +e.target.dataset.resize);
  if (e.target.closest('[data-sort]') || e.target.closest('input')) return;
  stopEdit(true);
  if (cell) { e.preventDefault(); grid.focus({preventScroll: true}); setSel(+cell.dataset.r, +cell.dataset.c, e.shiftKey); dragSel = 'cell'; }
  else if (rnum) {
    e.preventDefault(); grid.focus({preventScroll: true});
    const r = +rnum.dataset.r, s = sh.sel;
    if (!e.shiftKey) { s.ar = r; } s.fr = r; s.ac = 0; s.fc = sh.cols.length - 1;
    renderGrid(); updateUI(); dragSel = 'row';
  } else if (th) {
    e.preventDefault(); grid.focus({preventScroll: true});
    const c = +th.dataset.c, s = sh.sel;
    if (!e.shiftKey) s.ac = c;
    s.fc = c; s.ar = 0; s.fr = Math.max(0, sh.view.length - 1);
    renderGrid(); updateUI(); buildColPanel(); dragSel = 'col';
  }
});
gInner.addEventListener('mouseover', e => {
  if (!dragSel || !(e.buttons & 1)) { dragSel = false; return; }
  const s = sheet().sel;
  const cell = e.target.closest('.g-cell'), rnum = e.target.closest('.g-num'), th = e.target.closest('.g-th');
  if (dragSel === 'cell' && cell) { s.fr = +cell.dataset.r; s.fc = +cell.dataset.c; }
  else if (dragSel === 'row' && (rnum || cell)) s.fr = +(rnum || cell).dataset.r;
  else if (dragSel === 'col' && (th || cell)) s.fc = +(th || cell).dataset.c;
  else return;
  renderGrid(); updateUI();
});
window.addEventListener('mouseup', () => { dragSel = false; });
gInner.addEventListener('dblclick', e => {
  const cell = e.target.closest('.g-cell');
  if (cell) return startEdit();
  const th = e.target.closest('.g-th');
  if (th && !e.target.closest('[data-sort],[data-resize]')) renameColumn(+th.dataset.c);
});
gInner.addEventListener('click', e => {
  const b = e.target.closest('[data-sort]'); if (!b) return;
  const sh = sheet(), c = +b.dataset.sort;
  sh.sort = sh.sort.c === c ? {c, dir: sh.sort.dir === 1 ? -1 : sh.sort.dir === -1 ? 0 : 1} : {c, dir: 1};
  refresh(true);
});
let filterT;
gInner.addEventListener('input', e => {
  const c = e.target.dataset.f; if (c == null) return;
  sheet().filters[c] = e.target.value;
  clearTimeout(filterT); filterT = setTimeout(() => refresh(true), 200);
});
$('#globalSearch').addEventListener('input', e => {
  const sh = sheet(); if (!sh) return;
  sh.query = e.target.value;
  clearTimeout(filterT); filterT = setTimeout(() => refresh(true), 200);
});
$('#globalSearch').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); grid.focus(); } });
function startResize(e, c) {
  e.preventDefault(); e.stopPropagation();
  const sh = sheet(), x0 = e.clientX, w0 = sh.cols[c].width;
  const move = ev => { const col = sh.cols[c]; col.width = Math.max(40, Math.round(w0 + ev.clientX - x0)); col.xw = +((col.width - 5) / 7).toFixed(2); layoutCols(sh); renderGrid(); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', () => window.removeEventListener('mousemove', move), {once: true});
}
grid.addEventListener('keydown', e => {
  if (e.target !== grid || !sheet()) return;
  const sh = sheet(), s = sh.sel, page = Math.max(1, Math.floor((grid.clientHeight - headH()) / rowH()) - 1);
  const move = (dr, dc) => { e.preventDefault(); setSel(s.fr + dr, s.fc + dc, e.shiftKey); };
  const ctrl = e.ctrlKey || e.metaKey;
  switch (e.key) {
    case 'ArrowUp': return ctrl ? (e.preventDefault(), setSel(0, s.fc, e.shiftKey)) : move(-1, 0);
    case 'ArrowDown': return ctrl ? (e.preventDefault(), setSel(sh.view.length - 1, s.fc, e.shiftKey)) : move(1, 0);
    case 'ArrowLeft': return ctrl ? (e.preventDefault(), setSel(s.fr, 0, e.shiftKey)) : move(0, -1);
    case 'ArrowRight': return ctrl ? (e.preventDefault(), setSel(s.fr, sh.cols.length - 1, e.shiftKey)) : move(0, 1);
    case 'PageUp': return move(-page, 0);
    case 'PageDown': return move(page, 0);
    case 'Home': e.preventDefault(); return setSel(ctrl ? 0 : s.fr, 0, e.shiftKey);
    case 'End': e.preventDefault(); return setSel(ctrl ? sh.view.length - 1 : s.fr, sh.cols.length - 1, e.shiftKey);
    case 'Tab': e.preventDefault(); return setSel(s.fr, s.fc + (e.shiftKey ? -1 : 1));
    case 'Enter': if (ctrl || e.altKey) return; e.preventDefault(); return setSel(s.fr + (e.shiftKey ? -1 : 1), s.fc);
    case 'F2': e.preventDefault(); return startEdit();
    case 'Delete': case 'Backspace': e.preventDefault(); return clearCells();
    case 'Escape': s.ar = s.fr; s.ac = s.fc; renderGrid(); updateUI(); return;
  }
  if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); s.ar = 0; s.ac = 0; s.fr = sh.view.length - 1; s.fc = sh.cols.length - 1; renderGrid(); updateUI(); return; }
  if (e.key.length === 1 && !ctrl && !e.altKey) { e.preventDefault(); startEdit(e.key); }
});

/* ================= Editing ================= */
let editor = null;
function startEdit(initial = null) {
  const sh = sheet(); if (!sh || !sh.view.length) return;
  stopEdit(true);
  const s = sh.sel, {xs, numW} = layoutCache, col = sh.cols[s.fc];
  ensureVisible(s.fr, s.fc); renderGrid();
  const inp = document.createElement('input');
  inp.className = 'cell-edit'; inp.spellcheck = false;
  Object.assign(inp.style, {left: numW + xs[s.fc] + 'px', top: headH() + s.fr * rowH() + 'px',
    width: Math.max(col.width, 160) + 'px', height: rowH() + 'px', textAlign: col.type === 'number' ? 'right' : 'left'});
  inp.value = initial != null ? initial : rawText(sh.rows[sh.view[s.fr]][s.fc]);
  grid.append(inp); inp.focus();
  if (initial == null) inp.select();
  editor = {inp, r: s.fr, c: s.fc, sheet: sh};
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); stopEdit(false); grid.focus(); }
    else if (e.key === 'Enter') { e.preventDefault(); stopEdit(true); grid.focus(); setSel(s.fr + (e.shiftKey ? -1 : 1), s.fc); }
    else if (e.key === 'Tab') { e.preventDefault(); stopEdit(true); grid.focus(); setSel(s.fr, s.fc + (e.shiftKey ? -1 : 1)); }
  });
  inp.addEventListener('blur', () => stopEdit(true));
}
function stopEdit(commit) {
  if (!editor) return;
  const {inp, r, c, sheet: sh} = editor;
  editor = null; inp.remove();
  if (!commit || sh !== sheet()) return;
  const row = sh.view[r]; if (row == null) return;
  const old = sh.rows[row][c], val = coerce(inp.value, sh.cols[c], old);
  if (rawText(old) === rawText(val) && typeof old === typeof val) return;
  doOp({t: 'cells', ch: [{r: row, c, o: old, n: val}]});
}
/* Keep JSON/Excel values typed: "12" in a number column stays a number. CSV keeps text exactly. */
function coerce(text, col, old) {
  const d = cur();
  if (d.format === 'csv' || d.format === 'tsv' || d.format === 'txt') return text;
  if (text === '') return '';
  if (col.type === 'number' || typeof old === 'number') { const n = toNumber(text, col.numStyle); if (Number.isFinite(n)) return n; }
  if (typeof old === 'boolean' && /^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  return text;
}
function clearCells() {
  const sh = sheet(); if (!sh || !sh.view.length) return;
  const {r0, r1, c0, c1} = selRange(sh.sel), ch = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const row = sh.view[r], o = sh.rows[row][c];
    if (!isEmpty(o)) ch.push({r: row, c, o, n: ''});
  }
  if (ch.length) doOp({t: 'cells', ch});
}

/* ================= Formula bar ================= */
function commitFx() {
  const sh = sheet(), inp = $('#fxIn'); if (!sh || !sh.view.length) return;
  const row = sh.view[sh.sel.fr], c = sh.sel.fc, old = sh.rows[row][c], val = coerce(inp.value, sh.cols[c], old);
  if (rawText(old) !== rawText(val) || typeof old !== typeof val) doOp({t: 'cells', ch: [{r: row, c, o: old, n: val}]});
}
$('#fxIn').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); commitFx(); grid.focus(); setSel(sheet().sel.fr + 1, sheet().sel.fc); }
  else if (e.key === 'Escape') { e.preventDefault(); $('#fxIn').value = ''; grid.focus(); updateUI(); }
});
$('#fxIn').addEventListener('change', commitFx);

/* ================= Clipboard ================= */
function selectionTsv() {
  const sh = sheet(), {r0, r1, c0, c1} = selRange(sh.sel);
  if ((r1 - r0 + 1) * (c1 - c0 + 1) > 1e6) { toast(t('toast.tooBig')); return null; }
  const q = s => /[\t\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  const lines = [];
  // Formulas are copied as their results, like Excel does when pasting into other apps.
  for (let r = r0; r <= r1; r++) {
    const i = sh.view[r], row = sh.rows[i], out = [];
    for (let c = c0; c <= c1; c++) out.push(q(Formula.isFormula(row[c]) ? displayCell(sh, i, c) : rawText(row[c])));
    lines.push(out.join('\t'));
  }
  return {text: lines.join('\r\n'), n: (r1 - r0 + 1) * (c1 - c0 + 1)};
}
document.addEventListener('copy', e => {
  if (document.activeElement !== grid || !sheet()) return;
  const out = selectionTsv(); if (!out) return;
  e.preventDefault(); e.clipboardData.setData('text/plain', out.text); toast(t('toast.copied', {n: num(out.n)}));
});
document.addEventListener('cut', e => {
  if (document.activeElement !== grid || !sheet()) return;
  const out = selectionTsv(); if (!out) return;
  e.preventDefault(); e.clipboardData.setData('text/plain', out.text); clearCells();
});
document.addEventListener('paste', e => {
  if (document.activeElement !== grid || !sheet()) return;
  e.preventDefault();
  pasteText(e.clipboardData.getData('text/plain'));
});
function pasteText(text) {
  const sh = sheet(); if (!text) return;
  const data = Papa.parse(text.replace(/\r?\n$/, ''), {delimiter: '\t'}).data;
  const {r0, c0} = selRange(sh.sel), ops = [], ch = [];
  const need = r0 + data.length - sh.view.length;
  if (need > 0) {
    const at = sh.rows.length;
    ops.push({t: 'rows+', at, rows: Array.from({length: need}, () => Array(sh.cols.length).fill(''))});
  }
  const viewRow = r => r < sh.view.length ? sh.view[r] : sh.rows.length + (r - sh.view.length);
  data.forEach((line, i) => line.forEach((v, j) => {
    const c = c0 + j; if (c >= sh.cols.length) return;
    const row = viewRow(r0 + i), o = row < sh.rows.length ? sh.rows[row][c] : '';
    ch.push({r: row, c, o, n: coerce(v, sh.cols[c], o)});
  }));
  ops.push({t: 'cells', ch});
  doOp(ops.length > 1 ? {t: 'batch', ops} : ops[0], need > 0);
  sh.sel.fr = Math.min(sh.view.length - 1, r0 + data.length - 1);
  sh.sel.fc = Math.min(sh.cols.length - 1, c0 + Math.max(...data.map(l => l.length)) - 1);
  renderGrid(); updateUI();
  toast(t('toast.pasted', {n: num(ch.length)}));
}

/* ================= Undo / redo (operations) ================= */
/* Merged cells follow inserted/deleted rows and columns: computed once per operation, restored exactly on undo. */
function applyOp(sh, op, undo) {
  if (sh.merges && sh.merges.length && op.t !== 'cells' && op.t !== 'fmt' && op.t !== 'rename' && op.t !== 'batch') {
    if (undo) { applyOpBase(sh, op, undo); if (op.mBefore) sh.merges = op.mBefore.map(m => ({...m})); return; }
    const before = sh.merges.map(m => ({...m})), rowsBefore = sh.rows.slice();
    applyOpBase(sh, op, undo);
    if (!op.mAfter) op.mAfter = remapMerges(sh, op, before, rowsBefore);
    op.mBefore = before; sh.merges = op.mAfter.map(m => ({...m}));
    return;
  }
  applyOpBase(sh, op, undo);
}
function applyOpBase(sh, op, undo) {
  switch (op.t) {
    case 'cells': for (const x of op.ch) { if (sh.rows[x.r]) sh.rows[x.r][x.c] = undo ? x.o : x.n; } break;
    case 'fmt': for (const x of op.ch) { const row = sh.rows[x.r]; if (!row) continue; const v = undo ? x.o : x.n; if (v == null) { if (row.fmt) delete row.fmt[x.c]; } else (row.fmt = row.fmt || {})[x.c] = v; } break;
    case 'rows+': if (undo) sh.rows.splice(op.at, op.rows.length); else sh.rows.splice(op.at, 0, ...op.rows.map(r => Object.assign(r.slice(), r.fmt ? {fmt: {...r.fmt}} : {}))); break;
    case 'rows-':
      if (undo) for (const it of op.items) sh.rows.splice(it.i, 0, it.row);
      else for (let k = op.items.length - 1; k >= 0; k--) sh.rows.splice(op.items[k].i, 1);
      break;
    case 'col+': case 'col-': {
      const add = (op.t === 'col+') !== undo;
      if (add) { sh.cols.splice(op.at, 0, {...op.col}); sh.rows.forEach((r, i) => r.splice(op.at, 0, op.vals[i] ?? '')); }
      else { if (!op.fmts) { op.fmts = sh.rows.map(r => r.fmt && r.fmt[op.at]); op.headF = sh.headFmt && sh.headFmt[op.at]; } sh.cols.splice(op.at, 1); sh.rows.forEach(r => r.splice(op.at, 1)); }
      shiftFmtCols(sh, op.at, add ? 1 : -1);
      if (add && op.fmts) { sh.rows.forEach((r, i) => { if (op.fmts[i] != null) (r.fmt = r.fmt || {})[op.at] = op.fmts[i]; }); if (op.headF != null) (sh.headFmt = sh.headFmt || {})[op.at] = op.headF; }
      shiftColState(sh, op.at, add ? 1 : -1);
      break;
    }
    case 'rename': sh.cols[op.c].name = undo ? op.o : op.n; break;
    case 'header': setHeader(sh, undo ? !op.on : op.on); break;
    case 'batch': (undo ? [...op.ops].reverse() : op.ops).forEach(o => applyOp(sh, o, undo)); break;
  }
}
function shiftColState(sh, at, delta) {
  const f = {};
  for (const [c, v] of Object.entries(sh.filters)) { const n = +c; if (delta < 0 && n === at) continue; f[n >= at ? n + delta : n] = v; }
  sh.filters = f;
  if (sh.sort.c === at && delta < 0) sh.sort = {c: -1, dir: 0};
  else if (sh.sort.c >= at) sh.sort.c += delta;
  sh.chart = null;
}
const structural = op => op.t !== 'cells' && op.t !== 'rename' && op.t !== 'fmt' || (op.t === 'batch');
function doOp(op, forceRecalc = false) {
  const d = cur(), sh = sheet();
  op.s = d.si;
  applyOp(sh, op, false);
  if (d.history.length < d.cleanDepth) d.cleanDepth = -1;
  d.history.push(op); if (d.history.length > 300) { d.history.shift(); d.cleanDepth--; }
  d.future = [];
  afterOp(sh, op, forceRecalc);
}
function afterOp(sh, op, forceRecalc) {
  const d = cur();
  // Pass the change on to the calculation engine: single cells directly, anything structural as the whole table.
  const onlyCells = o => o.t === 'cells' || o.t === 'fmt' || o.t === 'rename' || (o.t === 'batch' && o.ops.every(onlyCells));
  if (onlyCells(op)) {
    const ch = [], add = o => o.t === 'cells' ? o.ch.forEach(x => ch.push([x.r, x.c, toEngine(sh.rows[x.r] ? sh.rows[x.r][x.c] : '')])) : o.t === 'batch' ? o.ops.forEach(add) : null;
    add(op);
    if (ch.length && invoke && sh.eid) sh.engineReady = Promise.resolve(sh.engineReady).then(() => invoke('engine_set', {id: sh.eid, changes: ch}));
  } else { sh.fv = new Map(); engineLoad(sh); }
  d.dirty = d.history.length !== d.cleanDepth;
  if (op.t === 'col+' || op.t === 'col-' || op.t === 'header') measureCols(sh);
  // Structural changes re-filter and re-sort; cell edits only need new results and types.
  const full = forceRecalc || structural(op);
  refresh(full);
  if (!full && op.t !== 'fmt' && op.t !== 'rename') engineUpdate(sh);
  renderTabs();
}
function undoRedo(redo) {
  const d = cur(); if (!d) return;
  stopEdit(true);
  const from = redo ? d.future : d.history, to = redo ? d.history : d.future;
  if (!from.length) return;
  const op = from.pop(); to.push(op);
  if (op.s !== d.si) { d.si = op.s; $('#globalSearch').value = sheet().query; }
  applyOp(sheet(), op, !redo);
  afterOp(sheet(), op, true);
}

/* ================= Row & column operations ================= */
/* Inserting or deleting rows/columns rewrites formulas so they keep pointing at the same data (like Excel).
   move(r, c) gives a cell's new position, or null when it's deleted; the rewrite is part of the same undo step. */
function withFormulaFixups(sh, op, move) {
  const ch = [];
  sh.rows.forEach((row, r) => row.forEach((raw, c) => {
    if (!Formula.isFormula(raw)) return;
    const to = move(r, c); if (!to) return;
    const n = '=' + Formula.mapRefs(raw.slice(1), move);
    if (n !== raw) ch.push({r: to[0], c: to[1], o: raw, n});
  }));
  return ch.length ? {t: 'batch', ops: [op, {t: 'cells', ch}]} : op;
}
/* Counts how many of the sorted indexes lie before i, by binary search. */
const countBefore = (sorted, i) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < i) lo = m + 1; else hi = m; } return lo; };
function insertRow() {
  const sh = sheet(); if (!sh) return;
  const at = sh.view.length ? sh.view[sh.sel.fr] + 1 : sh.rows.length;
  doOp(withFormulaFixups(sh, {t: 'rows+', at, rows: [Array(sh.cols.length).fill('')]}, (r, c) => [r >= at ? r + 1 : r, c]));
  const r = sh.view.indexOf(at);
  if (r >= 0) setSel(r, sh.sel.fc);
}
function deleteRows() {
  const sh = sheet(); if (!sh || !sh.view.length) return;
  const {r0, r1} = selRange(sh.sel);
  const gone = sh.view.slice(r0, r1 + 1).sort((a, b) => a - b), goneSet = new Set(gone);
  const items = gone.map(i => ({i, row: sh.rows[i]}));
  doOp(withFormulaFixups(sh, {t: 'rows-', items}, (r, c) => goneSet.has(r) ? null : [r - countBefore(gone, r), c]));
  setSel(Math.min(r0, sh.view.length - 1), sh.sel.fc);
}
function insertCol() {
  const sh = sheet(); if (!sh) return;
  const at = sh.sel.fc + 1;
  let n = sh.cols.length + 1, name = t('ui.newColName', {n});
  while (sh.cols.some(c => c.name === name)) name = t('ui.newColName', {n: ++n});
  doOp(withFormulaFixups(sh, {t: 'col+', at, col: {name, type: 'text', numStyle: 'en', width: 120}, vals: []}, (r, c) => [r, c >= at ? c + 1 : c]));
  setSel(sh.sel.fr, at);
}
function deleteCols() {
  const sh = sheet(); if (!sh) return;
  const {c0, c1} = selRange(sh.sel);
  if (c1 - c0 + 1 >= sh.cols.length) return toast(t('toast.lastCol'));
  const ops = [], width = c1 - c0 + 1;
  for (let c = c1; c >= c0; c--) ops.push({t: 'col-', at: c, col: {...sh.cols[c]}, vals: sh.rows.map(r => r[c])});
  doOp(withFormulaFixups(sh, ops.length > 1 ? {t: 'batch', ops} : ops[0], (r, c) => c >= c0 && c <= c1 ? null : [r, c > c1 ? c - width : c]));
  sh.sel.ac = sh.sel.fc = Math.min(c0, sh.cols.length - 1);
  renderGrid();
}
function renameColumn(c = sheet().sel.fc) {
  const sh = sheet(), old = sh.cols[c].name;
  modal(t('ui.renameTitle'), `<input class="field-in" id="renameIn" value="${esc(old)}" spellcheck="false">`, [
    {label: t('ui.cancel'), onClick: closeModal},
    {label: t('ui.ok'), primary: true, onClick: () => {
      const v = $('#renameIn').value.trim(); closeModal();
      if (v && v !== old) doOp({t: 'rename', c, o: old, n: v});
      grid.focus();
    }}
  ]);
  const inp = $('#renameIn'); inp.focus(); inp.select();
  inp.onkeydown = e => { if (e.key === 'Enter') $('#modalFoot .primary').click(); };
}
function setHeader(sh, on) {
  if (on === sh.header) return;
  if (on) {
    const first = sh.rows.shift() || [];
    sh.headFmt = first.fmt || {};
    sh.cols.forEach((c, i) => { c.name = rawText(first[i]).trim() || colName(i); });
  } else {
    const names = sh.cols.map(c => c.name);
    if (sh.headFmt && Object.keys(sh.headFmt).length) names.fmt = sh.headFmt;
    sh.headFmt = {};
    sh.rows.unshift(names);
    sh.cols.forEach((c, i) => { c.name = colName(i); });
  }
  sh.header = on;
}
function sortBy(dir) { const sh = sheet(); if (!sh) return; sh.sort = {c: sh.sel.fc, dir}; refresh(true); }
function clearView() {
  const sh = sheet(); if (!sh) return;
  sh.sort = {c: -1, dir: 0}; sh.filters = {}; sh.query = ''; $('#globalSearch').value = '';
  refresh(true);
}

/* ================= Panels: column statistics, properties, chart settings ================= */
function buildPanels() { buildColPanel(); buildProps(); buildChartPanel(); }
/* The numbers come from Rust (stats.rs), worked out on the rows the table shows; only the newest answer is drawn. */
let colSeq = 0;
async function buildColPanel() {
  const box = $('#colPanel'), sh = sheet();
  if (!sh || settings.dockTab !== 'column') { if (!sh) box.innerHTML = ''; return; }
  const c = sh.sel.fc, col = sh.cols[c];
  if (!col) { box.innerHTML = `<div class="empty">${esc(t('ui.noColumn'))}</div>`; return; }
  if (!invoke || !sh.eid) return;
  const my = ++colSeq;
  await sh.engineReady;
  const s = await invoke('engine_col_stats', {id: sh.eid, col: c});
  if (my !== colSeq || sheet() !== sh || !s) return;
  const kv = (k, v) => `<div class="kv"><span>${esc(t(k))}</span><b title="${esc(v)}">${esc(v)}</b></div>`;
  let h = `<div class="col-title" title="${esc(col.name)}">${esc(col.name)}</div>
    ${kv('ui.type', t('type.' + col.type))}${kv('ui.values', num(s.values))}${kv('ui.empty', num(s.empty))}${kv('ui.unique', num(s.unique))}`;
  if (s.number) {
    const n = s.number;
    h += `<div class="sect">${esc(t('type.number'))}</div>${kv('ui.min', num(n.min))}${kv('ui.max', num(n.max))}
      ${kv('ui.sum', num(n.sum))}${kv('ui.mean', num(n.mean))}${kv('ui.median', num(n.median))}`;
  } else if (s.dates) {
    const f = serial => XFormat.fromSerial(serial).toLocaleString(lang, {dateStyle: 'medium'});
    h += `<div class="sect">${esc(t('type.date'))}</div>${kv('ui.earliest', f(s.dates[0]))}${kv('ui.latest', f(s.dates[1]))}`;
  }
  if (s.top.length) {
    const max = s.top[0][1];
    h += `<div class="sect">${esc(t('ui.top'))}</div><div class="bars">` + s.top.map(([k, n]) =>
      `<div class="bar"><span title="${esc(k)}">${esc(k)}</span><b>${num(n)}</b><i style="width:${Math.max(2, n / max * 100)}%"></i></div>`).join('') + '</div>';
  }
  h += `<p class="empty" style="padding:14px 0 0;text-align:left">${esc(t('ui.shownRows', {n: num(s.shown)}))}</p>`;
  box.innerHTML = h;
}
const FORMAT_NAMES = {csv: 'CSV', tsv: 'TSV', txt: 'Text (CSV)', json: 'JSON', jsonl: 'JSON Lines', xlsx: 'Excel (.xlsx)', xlsm: 'Excel (.xlsm)', xls: 'Excel 97–2003 (.xls)', ods: 'OpenDocument (.ods)'};
function buildProps() {
  const d = cur(), sh = sheet(), box = $('#props');
  if (!d) { box.innerHTML = ''; return; }
  const kv = (k, v) => v ? `<div class="kv"><span>${esc(t(k))}</span><b title="${esc(v)}">${esc(v)}</b></div>` : '';
  box.innerHTML = `<div class="sect">${esc(t('ui.file'))}</div>${kv('ui.format', FORMAT_NAMES[d.format] || d.format)}
    ${kv('ui.delimiter', d.delimiter ? t('delim.' + d.delimiter) : '')}${kv('ui.encoding', d.encoding)}${kv('ui.size', d.size ? fmtSize(d.size) : '')}
    ${kv('ui.path', d.path || '')}${kv('ui.sheets', d.sheets.length > 1 ? String(d.sheets.length) : '')}
    <div class="sect">${esc(t('ui.table2'))}</div>${kv('ui.rows', '') /* label only via status */}
    <div class="kv"><span>${esc(t('ui.cols', {n: ''}).trim())}</span><b>${num(sh.cols.length)}</b></div>
    <div class="kv"><span>${esc(t('ui.rows', {n: ''}).trim())}</span><b>${num(sh.rows.length)}</b></div>
    <label class="switch"><input type="checkbox" data-act-check="toggleHeader"${sh.header ? ' checked' : ''}><span></span>${esc(t('ui.headerRow'))}</label>`;
}
$('#props').addEventListener('change', e => { if (e.target.dataset.actCheck) run(e.target.dataset.actCheck); });

/* ================= Charts ================= */
let chart = null;
function chartCfg(sh) {
  if (!sh.chart) {
    const firstNum = sh.cols.findIndex(c => c.type === 'number');
    let x = sh.cols.findIndex(c => c.type === 'text' || c.type === 'date');
    if (x < 0) x = firstNum === 0 && sh.cols.length > 1 ? 1 : 0;
    const y = sh.cols.findIndex((c, i) => c.type === 'number' && i !== x);
    sh.chart = {type: 'bar', x, ys: y >= 0 ? [y] : [], agg: 'sum', limit: 30};
  }
  return sh.chart;
}
function buildChartPanel() {
  const box = $('#chartPanel'), sh = sheet();
  if (!sh) { box.innerHTML = ''; return; }
  if (settings.dockTab !== 'chart') return;
  const cfg = chartCfg(sh);
  const opt = (v, l, cv) => `<option value="${v}"${String(v) === String(cv) ? ' selected' : ''}>${esc(l)}</option>`;
  const nums = sh.cols.map((c, i) => [c, i]).filter(([c]) => c.type === 'number');
  box.innerHTML = `
    <div class="field"><label>${esc(t('ui.chartType'))}</label><select data-cfg="type">${['bar', 'line', 'pie', 'scatter'].map(v => opt(v, t('chart.' + v), cfg.type)).join('')}</select></div>
    <div class="field"><label>${esc(t('ui.xCol'))}</label><select data-cfg="x">${sh.cols.map((c, i) => opt(i, c.name, cfg.x)).join('')}</select></div>
    <div class="field"><label>${esc(t('ui.yCols'))}</label><div class="checks">${nums.length ? nums.map(([c, i]) =>
      `<label><input type="checkbox" data-y="${i}"${cfg.ys.includes(i) ? ' checked' : ''}>${esc(c.name)}</label>`).join('') : `<span class="empty" style="padding:4px">—</span>`}</div></div>
    <div class="field"><label>${esc(t('ui.agg'))}</label><select data-cfg="agg">${['none', 'sum', 'avg', 'count'].map(v => opt(v, t('agg.' + v), cfg.agg)).join('')}</select></div>
    <div class="field"><label>${esc(t('ui.limit'))}</label><select data-cfg="limit">${[10, 20, 30, 50, 100, 500].map(v => opt(v, String(v), cfg.limit)).join('')}</select></div>
    <button class="btn-sm" data-act="viewSplit" style="margin-top:6px">${esc(t('a.viewSplit'))}</button>`;
}
$('#chartPanel').addEventListener('change', e => {
  const sh = sheet(), cfg = chartCfg(sh), k = e.target.dataset.cfg;
  if (k) cfg[k] = k === 'x' || k === 'limit' ? +e.target.value : e.target.value;
  if (e.target.dataset.y != null) {
    const y = +e.target.dataset.y;
    cfg.ys = e.target.checked ? [...new Set([...cfg.ys, y])] : cfg.ys.filter(v => v !== y);
  }
  if (settings.view === 'table') { settings.view = 'split'; applySettings(); }
  renderChart();
});
const cssVar = n => getComputedStyle(document.body).getPropertyValue(n).trim();
/* Chart data (grouping, sum / average / count, order, limit) comes from Rust (stats.rs); this only draws it.
   Only the newest answer is drawn. */
let chartSeq = 0;
async function renderChart() {
  const sh = sheet(), my = ++chartSeq;
  const drop = () => { if (chart) { chart.destroy(); chart = null; } };
  if (!sh || settings.view === 'table' || !window.Chart || !invoke || !sh.eid) return drop();
  const cfg = chartCfg(sh);
  await sh.engineReady;
  const res = await invoke('engine_chart', {id: sh.eid, cfg});
  if (my !== chartSeq || sheet() !== sh) return;
  drop();
  const xcol = sh.cols[cfg.x], xName = xcol ? xcol.name : '';
  // Scatter charts over a date column use time values, like before.
  const data = res && {scatter: res.scatter, labels: res.labels, datasets: res.datasets.map(d => ({
    label: d.y == null ? t('agg.count') : sh.cols[d.y].name,
    data: res.scatter && xcol.type === 'date' ? d.data.map(p => ({x: XFormat.fromSerial(p.x).getTime(), y: p.y})) : d.data}))};
  const empty = $('#chartEmpty');
  $('#chartTitle').textContent = data ? `${cfg.agg === 'count' ? t('agg.count') : cfg.ys.map(y => sh.cols[y] && sh.cols[y].name).filter(Boolean).join(', ')} ${cfg.type === 'scatter' ? '' : t('ui.byX', {x: xName})}` : '';
  empty.textContent = data ? '' : t('ui.chartNeedNumber');
  empty.hidden = !!data;
  if (!data) return;
  const text = cssVar('--text'), line = cssVar('--grid-line');
  const pie = cfg.type === 'pie';
  data.datasets.forEach((ds, i) => {
    const c = PALETTE[i % PALETTE.length];
    Object.assign(ds, pie ? {backgroundColor: data.labels.map((_, k) => PALETTE[k % PALETTE.length]), borderColor: cssVar('--grid-bg'), borderWidth: 2}
      : {backgroundColor: cfg.type === 'line' ? c + '33' : c + 'cc', borderColor: c, borderWidth: cfg.type === 'line' ? 2 : 0,
        pointRadius: cfg.type === 'scatter' ? 3 : 2, fill: cfg.type === 'line' && data.datasets.length === 1, tension: 0.25, borderRadius: 3});
  });
  const scales = pie ? {} : {
    x: {type: data.scatter ? 'linear' : 'category', ticks: {color: text, maxRotation: 50, autoSkip: true}, grid: {color: line}, title: {display: true, text: xName, color: text}},
    y: {ticks: {color: text}, grid: {color: line}, beginAtZero: cfg.type === 'bar'}
  };
  chart = new Chart($('#chart'), {type: data.scatter ? 'scatter' : cfg.type, data: {labels: data.labels, datasets: data.datasets},
    options: {responsive: true, maintainAspectRatio: false, animation: {duration: 250}, scales,
      plugins: {legend: {display: pie || data.datasets.length > 1, labels: {color: text}}, tooltip: {mode: pie ? 'nearest' : 'index', intersect: false}}}});
}
async function exportChart() {
  if (!chart) return toast(t('ui.chartNeedNumber'));
  const src = $('#chart'), c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d'); ctx.fillStyle = cssVar('--grid-bg') || '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(src, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const name = cur().name.replace(/\.[^.]+$/, '') + (lang === 'de' ? '-Diagramm.png' : '-chart.png');
  const r = await writeBytes(new Uint8Array(await blob.arrayBuffer()), {name, filter: 'PNG', ext: 'png'}).catch(e => toast(t('toast.saveFail', {e})));
  if (r) toast(t('toast.exported', {name: r.path || r.name}));
}

/* ================= Saving & exporting ================= */
const FORMATS = {
  csv: {ext: 'csv', filter: 'CSV'}, csvSemi: {ext: 'csv', filter: 'CSV'}, tsv: {ext: 'tsv', filter: 'TSV'},
  json: {ext: 'json', filter: 'JSON'}, jsonl: {ext: 'jsonl', filter: 'JSON Lines'}, xlsx: {ext: 'xlsx', filter: 'Excel'}, md: {ext: 'md', filter: 'Markdown'}
};
function typed(v, col) {
  if (isEmpty(v)) return null;
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') return v;
  if (col.type === 'number') { const n = toNumber(v, col.numStyle); if (Number.isFinite(n)) return n; }
  if (col.type === 'bool' && /^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === 'true';
  return v;
}
/* Row indexes to write: all rows in stored order, or only the rows shown (filter and sort applied). */
const rowIndexes = (sh, onlyVisible) => onlyVisible ? sh.view : sh.rows.map((_, i) => i);
/* A formula as a spreadsheet file stores it: rows counted with the column-name row as row 1. */
const toExcelFormula = (sh, raw) => '=' + (sh.header ? Formula.shiftRows(raw.slice(1), 1) : raw.slice(1));
function serialize(d, fmt, onlyVisible, keepRaw) {
  const sh = sheet(), cols = sh.cols, idx = rowIndexes(sh, onlyVisible);
  // Exports write calculated results; saving a CSV in its own format keeps the formulas (Excel calculates them on open).
  const value = (s, i, c) => { const v = cellValue(s, i, c); return Formula.isError(v) ? v.code : v; };
  if (fmt === 'csv' || fmt === 'csvSemi' || fmt === 'tsv') {
    const delim = fmt === 'tsv' ? '\t' : fmt === 'csvSemi' ? ';' : keepRaw ? d.delimiter || ',' : ',';
    const cell = (i, c) => {
      const raw = sh.rows[i][c], col = cols[c];
      if (keepRaw && Formula.isFormula(raw)) return toExcelFormula(sh, raw);
      const v = keepRaw ? raw : value(sh, i, c);
      if (fmt === 'csvSemi' && col.type === 'number' && (col.numStyle === 'en' || typeof v === 'number')) { const n = toNumber(v, 'en'); if (Number.isFinite(n)) return String(n).replace('.', ','); }
      return typeof v === 'number' ? String(+v.toPrecision(15)) : rawText(v);
    };
    const rows = [...(sh.header || !keepRaw ? [cols.map(c => c.name)] : []), ...idx.map(i => cols.map((_, c) => cell(i, c)))];
    return tableWrite({format: 'csv', delimiter: delim, bom: fmt === 'csvSemi' || (keepRaw && !!d.bom), rows});
  }
  if (fmt === 'json' || fmt === 'jsonl') {
    const rows = idx.map(i => cols.map((c, ci) => { const v = typed(value(sh, i, ci), c); return v instanceof Date ? isoDate(v) : typeof v === 'number' && !Number.isFinite(v) ? null : v; }));
    return tableWrite({format: fmt, columns: cols.map(c => c.name), rows});
  }
  if (fmt === 'md') return tableWrite({format: 'md', columns: cols.map(c => c.name), numeric: cols.map(c => c.type === 'number'), rows: idx.map(i => cols.map((_, c) => displayCell(sh, i, c)))});
  if ((fmt === 'xlsx' || fmt === 'xlsm') && invoke) return writeXlsx(d, onlyVisible, value);
  if (fmt === 'xlsx' || SHEET_EXT.includes(fmt)) {
    const wb = XLSX.utils.book_new();
    d.sheets.forEach(s => {
      const rs = s === sh ? idx : rowIndexes(s, false);
      // Without a header row the column names are only placeholders (A, B, …), so the data starts in row 1.
      const head = s.header ? 1 : 0;
      const aoa = [...(head ? [s.cols.map(c => c.name)] : []), ...rs.map(i => s.cols.map((col, c) => typed(value(s, i, c), col)))];
      const ws = XLSX.utils.aoa_to_sheet(aoa, {cellDates: true});
      // Formulas stay formulas in Excel (only when all rows are written, so references stay valid).
      if (s !== sh || !onlyVisible) rs.forEach((i, k) => s.rows[i].forEach((raw, c) => {
        if (!Formula.isFormula(raw)) return;
        const addr = XLSX.utils.encode_cell({r: k + head, c}), v = aoa[k + head][c];
        ws[addr] = {...(ws[addr] || {}), f: Formula.toExcel(toExcelFormula(s, raw).slice(1)), t: typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : 's', v: v ?? ''};
      }));
      XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31) || 'Sheet');
    });
    return new Uint8Array(XLSX.write(wb, {type: 'array', bookType: fmt === 'xlsx' ? 'xlsx' : fmt === 'xlsm' ? 'xlsx' : fmt}));
  }
  throw new Error('Unknown format ' + fmt);
}
/* Excel files are written in Rust (xlsx.rs): starting from the original file when there is one, so dropdown lists,
   conditional formats, frozen panes, print settings and images stay; cells, styles, merges and sizes come from here. */
async function writeXlsx(d, onlyVisible, value) {
  const active = sheet();
  const sheets = d.sheets.map(s => {
    const full = !(s === active && onlyVisible), rs = full ? rowIndexes(s, false) : rowIndexes(s, true), head = s.header ? 1 : 0;
    const cells = [], ref = v => v == null ? null : v;
    if (head) s.cols.forEach((col, c) => {
      const st = ref(s.headFmt && s.headFmt[c]), placeholder = col.autoName && col.name === colName(c);
      if (!placeholder || st != null) cells.push([0, c, 's', placeholder ? '' : col.name, st]);
    });
    rs.forEach((i, k) => {
      const row = s.rows[i], r = k + head;
      row.forEach((raw, c) => {
        let st = ref(row.fmt && row.fmt[c]);
        if (Formula.isFormula(raw) && full) return cells.push([r, c, 'f', Formula.toExcel(toExcelFormula(s, raw).slice(1)), st]);
        const v = typed(value(s, i, c), s.cols[c]);
        if (isEmpty(v)) { if (st != null) cells.push([r, c, 's', '', st]); return; }
        if (v instanceof Date) {
          // Dates need a date format in Excel, otherwise they show as numbers.
          const cur = styleOf(d, st);
          if (!cur || !cur.nf) st = withSet(st, {nf: v.getHours() || v.getMinutes() ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd'});
          return cells.push([r, c, 'd', XFormat.toSerial(v), st]);
        }
        cells.push([r, c, typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : 's', typeof v === 'number' || typeof v === 'boolean' ? v : String(v), st]);
      });
    });
    const merges = full ? (s.merges || []).map(m => [m.r + head, m.c, m.rs, m.cs]).filter(m => m[0] >= 0) : [];
    const widths = s.cols.map((col, c) => [c, col.xw != null ? col.xw : +Math.max(4, (col.width - 5) / 7).toFixed(2), !!col.xhidden]);
    const heights = full ? [...(head && s.headHt ? [[0, s.headHt]] : []), ...rs.map((i, k) => s.rows[i].ht ? [k + head, s.rows[i].ht] : null).filter(Boolean)] : [];
    return {name: s.name, cells, merges, widths, heights};
  });
  const original = d.path && ['xlsx', 'xlsm'].includes(extOf(d.path)) ? d.path : null;
  return new Uint8Array(await invoke('xlsx_write', {req: {original, token: d.xtoken || null, sheets}}));
}
/* CSV / JSON / JSON Lines / Markdown files are encoded in Rust (table.rs): quoting, separators, BOM, line endings. */
async function tableWrite(req) { return new Uint8Array(await invoke('table_write', {req})); }
const toBytes = out => typeof out === 'string' ? new TextEncoder().encode(out) : out;
/* Saves in the file's own format (CSV keeps its separator and text exactly). */
async function save() {
  const d = cur(); if (!d) return;
  stopEdit(true);
  if (d.isNew || !d.path && invoke) return exportDialog(true);
  const fmt = ['csv', 'txt'].includes(d.format) ? 'csv' : d.format;
  try {
    const bytes = toBytes(await serialize(d, fmt, false, true));
    const r = await writeBytes(bytes, {path: d.path, name: d.name, filter: FORMAT_NAMES[d.format] || 'Data', ext: extOf(d.name)});
    if (!r) return;
    markSaved(d, r, bytes.length);
  } catch (e) { toast(t('toast.saveFail', {e: e.message || e})); }
}
function markSaved(d, r, size) {
  if (r.path) { d.path = r.path; d.name = r.name; addRecent(r.path, r.name); }
  d.size = size; d.cleanDepth = d.history.length; d.dirty = false; d.isNew = false;
  renderTabs(); updateUI(); buildProps(); saveState();
  toast(t('toast.saved', {name: d.name}));
}
function exportDialog(saveAs) {
  const d = cur(); if (!d) return;
  stopEdit(true);
  const def = saveAs ? (d.format === 'jsonl' ? 'jsonl' : d.format === 'json' ? 'json' : d.format === 'tsv' ? 'tsv' : SHEET_EXT.includes(d.format) ? 'xlsx' : d.delimiter === ';' ? 'csvSemi' : 'csv') : 'xlsx';
  const list = ['csv', 'csvSemi', 'tsv', 'json', 'jsonl', 'xlsx', ...(saveAs ? [] : ['md'])];
  modal(t(saveAs ? 'ui.saveAsTitle' : 'ui.exportTitle'), `<div class="fmt-list">${list.map(f =>
    `<label><input type="radio" name="fmt" value="${f}"${f === def ? ' checked' : ''}><span>${esc(t('fmt.' + f))}<small>${esc(t('fmt.' + f + 'D'))}</small></span></label>`).join('')}</div>
    ${saveAs ? '' : `<label class="switch"><input type="checkbox" id="onlyVis"${sheet().view.length !== sheet().rows.length ? ' checked' : ''}><span></span>${esc(t('ui.onlyVisible'))}</label>`}`, [
    {label: t('ui.cancel'), onClick: closeModal},
    {label: t(saveAs ? 'ui.save' : 'ui.export'), primary: true, onClick: async () => {
      const fmt = $('input[name="fmt"]:checked').value, only = !saveAs && $('#onlyVis').checked;
      closeModal();
      const {ext, filter} = FORMATS[fmt], name = d.name.replace(/\.[^.]+$/, '') + '.' + ext;
      try {
        const bytes = toBytes(await serialize(d, fmt, only, false));
        const r = await writeBytes(bytes, {name, filter, ext});
        if (!r) return;
        if (saveAs) {
          Object.assign(d, {format: fmt === 'csvSemi' ? 'csv' : fmt, delimiter: fmt === 'csvSemi' ? ';' : fmt === 'tsv' ? '\t' : fmt === 'csv' ? ',' : '',
            bom: fmt === 'csvSemi', encoding: fmt === 'xlsx' ? '' : fmt === 'csvSemi' ? 'UTF-8 (BOM)' : 'UTF-8'});
          if (fmt !== 'xlsx') { const sh = sheet(); d.sheets = [sh]; d.si = 0; }
          markSaved(d, r.path ? r : {...r, path: null}, bytes.length);
          if (!r.path) d.name = name;
          renderTabs();
        } else toast(t('toast.exported', {name: r.path || r.name}));
      } catch (e) { toast(t('toast.saveFail', {e: e.message || e})); }
    }}
  ]);
}

/* ================= Status & title ================= */
function updateUI() {
  const d = cur(), sh = sheet();
  $('#apptitle').textContent = d ? `${d.name}${d.dirty ? ' ●' : ''}  —  Data Studio` : 'Data Studio';
  document.title = d ? `${d.dirty ? '● ' : ''}${d.name} — Data Studio` : 'Data Studio';
  const st = $('#stState');
  st.className = 'st-state' + (d && d.dirty ? ' dirty' : '');
  st.textContent = d ? (d.dirty ? t('st.dirty') : t('st.saved')) : '';
  if (!sh) { ['#stRows', '#stCell', '#stSel', '#stFormat', '#stSize'].forEach(s => $(s).textContent = ''); return; }
  $('#stRows').textContent = (sh.view.length === sh.rows.length ? t('ui.rows', {n: num(sh.rows.length)}) : t('ui.rowsFiltered', {n: num(sh.view.length), total: num(sh.rows.length)})) +
    ' · ' + t('ui.cols', {n: num(sh.cols.length)});
  const s = sh.sel, col = sh.cols[s.fc];
  $('#stCell').textContent = sh.view.length && col ? t('ui.cell', {r: num(sh.view[s.fr] + 1), c: col.name}) : '';
  const {r0, r1, c0, c1} = selRange(s);
  let sel = '';
  if ((r1 > r0 || c1 > c0) && (r1 - r0 + 1) * (c1 - c0 + 1) <= 500000) {
    let n = 0, sum = 0, cnt = 0;
    for (let r = r0; r <= r1; r++) { for (let c = c0; c <= c1; c++) { const v = cellValue(sh, sh.view[r], c); if (isEmpty(v) || Formula.isError(v)) continue; n++; const x = toNumber(v, sh.cols[c].numStyle); if (Number.isFinite(x)) { sum += x; cnt++; } } }
    sel = t('ui.selStats', {n: num(n)}) + (cnt ? ' · ' + t('ui.selSum', {v: num(sum)}) + ' · ' + t('ui.selAvg', {v: num(sum / cnt)}) : '');
  }
  $('#stSel').textContent = sel;
  // Formula bar: address and raw content (formula) of the focused cell.
  const fxIn = $('#fxIn'), row = sh.view.length ? sh.view[s.fr] : -1;
  $('#fxRef').textContent = row >= 0 && col ? Formula.cellName(row, s.fc) : '';
  fxIn.disabled = row < 0;
  if (document.activeElement !== fxIn) fxIn.value = row >= 0 && col ? rawText(sh.rows[row][s.fc]) : '';
  $('#stFormat').textContent = FORMAT_NAMES[d.format] || d.format;
  syncFormatBar();
  $('#stSize').textContent = d.size ? fmtSize(d.size) : '';
}

/* ================= Menus, toolbars, shortcuts ================= */
const ICONS = {
  open: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  newt: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M10 4v16M16 13v6M13 16h6"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
  export: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>',
  rowAdd: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="7" rx="1"/><path d="M12 15v6M9 18h6"/></svg>',
  rowDel: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="7" rx="1"/><path d="M9 18h6"/></svg>',
  colAdd: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="7" height="18" rx="1"/><path d="M15 12h6M18 9v6"/></svg>',
  colDel: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="7" height="18" rx="1"/><path d="M15 12h6"/></svg>',
  sortAsc: '<svg viewBox="0 0 24 24"><path d="M7 20V4M3 8l4-4 4 4M14 6h4M14 12h6M14 18h8"/></svg>',
  sortDesc: '<svg viewBox="0 0 24 24"><path d="M7 4v16M3 16l4 4 4-4M14 6h8M14 12h6M14 18h4"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M3 4h18l-7 8v6l-4 2v-8z"/></svg>',
  clear: '<svg viewBox="0 0 24 24"><path d="M3 4h18l-7 8v6l-4 2v-8z"/><path d="m16 16 5 5M21 16l-5 5"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/></svg>',
  panel: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/></svg>',
  rows: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  alignL: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 10h10M4 14h16M4 18h10"/></svg>',
  alignC: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 10h10M4 14h16M7 18h10"/></svg>',
  alignR: '<svg viewBox="0 0 24 24"><path d="M4 6h16M10 10h10M4 14h16M10 18h10"/></svg>',
  wrap: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M15 16l-2 2 2 2M4 18h5"/></svg>',
  borders: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/><path d="M12 4v16M4 12h16"/></svg>',
  fill: '<svg viewBox="0 0 24 24"><path d="m5 11 7-7 7 7-7 7z"/><path d="M19 15s2 2.2 2 3.5a2 2 0 0 1-4 0c0-1.3 2-3.5 2-3.5z"/></svg>',
  numfmt: '<svg viewBox="0 0 24 24"><path d="M5 9h4M7 7v12M12 7h3a2 2 0 0 1 0 4h-1a2 2 0 0 0 0 4h3M17 19l2-2"/></svg>',
  eraser: '<svg viewBox="0 0 24 24"><path d="m7 21-4-4 10-10 7 7-7 7z"/><path d="M14 21h7M9 11l7 7"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/></svg>'
};
const setView = v => { settings.view = v; applySettings(); };
const A = {
  openFile: async () => openFiles(await pickFiles()), newTable, save, saveAs: () => exportDialog(true), exportAs: () => exportDialog(false),
  closeTab: () => closeTab(active), undo: () => undoRedo(false), redo: () => undoRedo(true),
  copy: () => { const out = selectionTsv(); if (out) navigator.clipboard.writeText(out.text).then(() => toast(t('toast.copied', {n: num(out.n)}))); },
  selectAll: () => { const sh = sheet(), s = sh.sel; s.ar = 0; s.ac = 0; s.fr = sh.view.length - 1; s.fc = sh.cols.length - 1; grid.focus(); renderGrid(); updateUI(); },
  editCell: () => startEdit(), clearCells, find: () => { $('#globalSearch').focus(); $('#globalSearch').select(); },
  insertRow, deleteRows, insertCol, deleteCol: deleteCols, renameCol: () => renameColumn(),
  sortAsc: () => sortBy(1), sortDesc: () => sortBy(-1), clearView,
  toggleFilters: () => { settings.filters = !settings.filters; applySettings(); },
  fmtBold: toggleFlag('b'), fmtItalic: toggleFlag('i'), fmtUnderline: toggleFlag('u'), fmtStrike: toggleFlag('s'), fmtWrap: toggleFlag('wrap'),
  fmtAlignLeft: () => applyFormat({ha: (focusStyle() || {}).ha === 'left' ? null : 'left'}), fmtAlignCenter: () => applyFormat({ha: (focusStyle() || {}).ha === 'center' ? null : 'center'}),
  fmtAlignRight: () => applyFormat({ha: (focusStyle() || {}).ha === 'right' ? null : 'right'}),
  fmtBorders: () => applyFormat({bd: (focusStyle() || {}).bd ? 'none' : 'all'}), fmtFontColor: () => $('#fcPick').click(), fmtFill: () => $('#bgPick').click(),
  fmtNoFill: () => applyFormat({bg: null}), fmtClear: () => applyFormat({clear: 1}), fmtNumber: numberFormatMenu,
  toggleHeader: () => {
    // The first row becomes the column names (or the names become row 1): formulas move with their rows, like deleting/inserting a row.
    const sh = sheet(), on = !sh.header;
    doOp(withFormulaFixups(sh, {t: 'header', on}, on ? (r, c) => r === 0 ? null : [r - 1, c] : (r, c) => [r + 1, c]));
  },
  viewTable: () => setView('table'), viewSplit: () => setView('split'), viewChart: () => setView('chart'),
  togglePanels: () => { settings.dock = !settings.dock; applySettings(); },
  toggleCompact: () => { settings.compact = !settings.compact; applySettings(); },
  exportChart, settings: () => openSettings(),
  langAuto: () => setPref('lang', 'auto'), langEn: () => setPref('lang', 'en'), langDe: () => setPref('lang', 'de'),
  themeDark: () => setPref('theme', 'dark'), themeLight: () => setPref('theme', 'light'),
  themeGithub: () => setPref('theme', 'github'), themeGithubDark: () => setPref('theme', 'github-dark'),
  shortcuts: () => {
    let h = '';
    MENUS.forEach(([m, items]) => {
      const rows = items.filter(it => Array.isArray(it) && it[1]);
      if (rows.length) h += `<h4>${esc(t('menu.' + m))}</h4><table>` + rows.map(it => `<tr><td>${esc(t('a.' + it[0]))}</td><td><kbd>${esc(fmtKey(it[1]))}</kbd></td></tr>`).join('') + '</table>';
    });
    h += `<h4>${esc(t('sc.grid'))}</h4><table>` + [['sc.move', 'sc.moveKey'], ['sc.extend', 'sc.extendKey'], ['sc.edit', 'sc.editKey'], ['sc.paste', 'sc.pasteKey'], ['sc.width', 'sc.widthKey']]
      .map(([a, b]) => `<tr><td>${esc(t(a))}</td><td>${esc(t(b))}</td></tr>`).join('') + '</table>';
    modal(t('a.shortcuts'), h);
  },
  about: async () => {
    const v = invoke ? await window.__TAURI__.app.getVersion().catch(() => '') : '';
    modal(t('a.about'), `${v ? `<p><b>${t('about.version', {v: esc(v)})}</b></p>` : ''}<p>${t('about.p1')}</p><p>${t('about.p2')}</p><p>${t('about.p3')}</p>`);
  }
};
// [action, shortcut, checked(), handledElsewhere]
const MENUS = [
  ['file', [['openFile', 'Ctrl+O'], ['newTable', 'Alt+N'], '-', ['save', 'Ctrl+S'], ['saveAs', 'Ctrl+Shift+S'], ['exportAs', 'Ctrl+E'], '-', ['closeTab', 'Alt+W']]],
  ['edit', [['undo', 'Ctrl+Z'], ['redo', 'Ctrl+Y'], '-', ['copy', 'Ctrl+C', null, true], ['selectAll', 'Ctrl+A', null, true], '-',
    ['editCell', 'F2', null, true], ['clearCells', 'Delete', null, true], '-', ['find', 'Ctrl+F']]],
  ['format', [['fmtBold', 'Ctrl+B'], ['fmtItalic', 'Ctrl+I'], ['fmtUnderline', 'Ctrl+U'], ['fmtStrike', 'Ctrl+5'], '-',
    ['fmtFontColor'], ['fmtFill'], ['fmtNoFill'], ['fmtBorders'], '-', ['fmtAlignLeft'], ['fmtAlignCenter'], ['fmtAlignRight'], ['fmtWrap'], '-', ['fmtNumber'], ['fmtClear']]],
  ['data', [['insertRow', 'Ctrl+Enter'], ['deleteRows', 'Ctrl+-'], ['insertCol', 'Ctrl+Shift+Enter'], ['deleteCol', 'Ctrl+Shift+-'], ['renameCol'], '-',
    ['sortAsc', 'Alt+ArrowUp'], ['sortDesc', 'Alt+ArrowDown'], ['toggleFilters', 'Ctrl+Shift+F', () => settings.filters], ['clearView', 'Ctrl+Shift+L'], '-',
    ['toggleHeader', null, () => sheet() && sheet().header]]],
  ['view', [['viewTable', 'Alt+1', () => settings.view === 'table'], ['viewSplit', 'Alt+2', () => settings.view === 'split'],
    ['viewChart', 'Alt+3', () => settings.view === 'chart'], '-', ['togglePanels', 'Ctrl+\\', () => settings.dock],
    ['toggleCompact', null, () => settings.compact], '-', ['exportChart']]],
  ['settings', [['settings', 'Ctrl+,'], '-', '#menu.language',
    ['langAuto', null, () => settings.lang === 'auto'], ['langEn', null, () => settings.lang === 'en'], ['langDe', null, () => settings.lang === 'de'],
    '-', '#menu.theme',
    ['themeDark', null, () => settings.theme === 'dark'], ['themeLight', null, () => settings.theme === 'light'],
    ['themeGithub', null, () => settings.theme === 'github'], ['themeGithubDark', null, () => settings.theme === 'github-dark']]],
  ['help', [['shortcuts'], '-', ['about']]]
];
const KEYMAP = {};
MENUS.forEach(([, items]) => items.forEach(it => { if (Array.isArray(it) && it[1] && !it[3]) KEYMAP[it[1]] = it[0]; }));
const NO_DOC = new Set(['openFile', 'newTable', 'settings', 'langAuto', 'langEn', 'langDe', 'themeDark', 'themeLight', 'themeGithub',
  'themeGithubDark', 'shortcuts', 'about', 'togglePanels', 'toggleCompact', 'viewTable', 'viewSplit', 'viewChart', 'toggleFilters']);
const allowed = act => act.startsWith('fmt') ? canFormat() : !!cur() || NO_DOC.has(act);
function run(act) { if (allowed(act)) A[act](); }
function syncDisabled() { $$('[data-act]').forEach(b => b.disabled = !allowed(b.dataset.act)); $('#globalSearch').disabled = !cur(); }

let menuOpen = null;
function openMenu(m, items) {
  closeMenus();
  const dd = m.querySelector('.dropdown'); dd.innerHTML = '';
  items.forEach(it => {
    if (it === '-') return dd.append(document.createElement('hr'));
    if (typeof it === 'string') { const l = document.createElement('div'); l.className = 'dd-label'; l.textContent = t(it.slice(1)); return dd.append(l); }
    const [act, key, check] = it, b = document.createElement('button');
    b.innerHTML = `<span class="chk">${check && check() ? '&#10003;' : ''}</span><span>${esc(t('a.' + act))}</span><kbd>${esc(key ? fmtKey(key) : '')}</kbd>`;
    b.disabled = !allowed(act);
    b.onmousedown = e => e.preventDefault();
    b.onclick = () => { closeMenus(); run(act); };
    dd.append(b);
  });
  m.classList.add('open'); menuOpen = m;
}
function closeMenus() { $$('.menu.open').forEach(x => x.classList.remove('open')); menuOpen = null; }
function buildMenubar() {
  const nav = $('#menus'); nav.innerHTML = ''; menuOpen = null;
  MENUS.forEach(([name, items]) => {
    const m = document.createElement('div'), b = document.createElement('button'), dd = document.createElement('div');
    m.className = 'menu'; dd.className = 'dropdown'; b.textContent = t('menu.' + name);
    b.onmousedown = e => e.preventDefault();
    b.onclick = () => menuOpen === m ? closeMenus() : openMenu(m, items);
    b.onmouseenter = () => { if (menuOpen && menuOpen !== m) openMenu(m, items); };
    m.append(b, dd); nav.append(m);
  });
}
document.addEventListener('mousedown', e => { if (menuOpen && !e.target.closest('.menu')) closeMenus(); });
const keyOf = act => { for (const [, items] of MENUS) for (const it of items) if (Array.isArray(it) && it[0] === act && it[1]) return it[1]; return ''; };
const tip = act => t('a.' + act) + (keyOf(act) ? ` (${fmtKey(keyOf(act))})` : '');
function makeBtn(act, html) {
  const b = document.createElement('button');
  b.className = 'ibtn'; b.innerHTML = html; b.title = tip(act); b.dataset.act = act;
  return b;
}
function buildToolbars() {
  const fill = (id, list) => { const box = $(id); box.innerHTML = ''; list.forEach(([a, i]) => box.append(makeBtn(a, i))); };
  fill('#fileBtns', [['openFile', ICONS.open], ['newTable', ICONS.newt], ['save', ICONS.save], ['undo', ICONS.undo], ['redo', ICONS.redo], ['exportAs', ICONS.export]]);
  fill('#viewBtns', [['toggleCompact', ICONS.rows], ['togglePanels', ICONS.panel], ['settings', ICONS.gear], ['shortcuts', ICONS.help]]);
  const tools = $('#tools'); tools.innerHTML = '';
  // Formatting sits in the tool rail like in Markdown Studio; rows, columns and the view follow below.
  const letter = (a, html) => { const b = makeBtn(a, html); b.classList.add('txt'); return b; };
  [['fmtBold', '<b>B</b>', 1], ['fmtItalic', '<i style="font-family:Georgia,serif">I</i>', 1], ['fmtUnderline', '<u>U</u>', 1],
    ['fmtFontColor', '<span class="cbtn">A<i id="fcBar"></i></span>', 1], ['fmtFill', `<span class="cbtn">${ICONS.fill}<i id="bgBar"></i></span>`, 1],
    ['fmtAlignLeft', ICONS.alignL], ['fmtAlignCenter', ICONS.alignC], ['fmtAlignRight', ICONS.alignR], ['fmtWrap', ICONS.wrap], ['fmtBorders', ICONS.borders],
    ['fmtNumber', ICONS.numfmt], ['fmtClear', ICONS.eraser], '-',
    ['insertRow', ICONS.rowAdd], ['deleteRows', ICONS.rowDel], ['insertCol', ICONS.colAdd], ['deleteCol', ICONS.colDel], '-',
    ['sortAsc', ICONS.sortAsc], ['sortDesc', ICONS.sortDesc], ['toggleFilters', ICONS.filter], ['clearView', ICONS.clear], '-', ['viewSplit', ICONS.chart]]
    .forEach(r => { if (r === '-') { const s = document.createElement('div'); s.className = 'sep'; tools.append(s); } else tools.append(r[2] ? letter(r[0], r[1]) : makeBtn(r[0], r[1])); });
  $('#viewSeg').innerHTML = [['viewTable', 'ui.table'], ['viewSplit', 'ui.split'], ['viewChart', 'ui.chart']]
    .map(([a, l]) => `<button data-act="${a}" title="${esc(tip(a))}">${esc(t(l))}</button>`).join('');
}
document.addEventListener('mousedown', e => { if (e.target.closest('.ibtn,.cta,#viewSeg button')) e.preventDefault(); });
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) run(b.dataset.act); });
$$('#dockTabs button').forEach(b => b.onclick = () => { settings.dock = true; settings.dockTab = b.dataset.tab; applySettings(); });

function comboOf(e) {
  let k = e.key;
  if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (e.code === 'Minus' || e.code === 'NumpadSubtract') k = '-';
  else if (e.code === 'Comma') k = ',';
  else if (e.code === 'Backslash' || e.code === 'IntlBackslash') k = '\\';
  else if (k.length === 1) k = k.toUpperCase();
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.altKey ? 'Alt+' : '') + k;
}
const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); };
const EDIT_ACTS = new Set(['undo', 'redo', 'insertRow', 'deleteRows', 'insertCol', 'deleteCol', 'fmtBold', 'fmtItalic', 'fmtUnderline', 'fmtStrike']);
$('#fcPick').addEventListener('change', e => applyFormat({fc: e.target.value.toUpperCase()}));
$('#bgPick').addEventListener('change', e => applyFormat({bg: e.target.value.toUpperCase()}));
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('#modal').classList.contains('show')) { e.preventDefault(); closeModal(); }
    else if (menuOpen) closeMenus();
    return;
  }
  if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) { e.preventDefault(); return; }   // no accidental reload
  if (e.ctrlKey && e.altKey) return;   // AltGr on international keyboards types characters
  const act = KEYMAP[comboOf(e)];
  if (!act || (typing() && EDIT_ACTS.has(act))) return;
  e.preventDefault(); e.stopPropagation(); run(act);
}, true);

/* ================= Modal, toast, settings ================= */
function modal(title, html, buttons = null) {
  $('.modal').classList.remove('wide'); settingsOpen = false;
  $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html;
  const foot = $('#modalFoot');
  foot.hidden = !buttons; foot.innerHTML = '';
  if (buttons) {
    foot.append(Object.assign(document.createElement('span'), {className: 'flex'}));
    buttons.forEach(b => { const el = document.createElement('button'); el.className = 'btn-sm' + (b.primary ? ' primary' : ''); el.textContent = b.label; el.onclick = b.onClick; foot.append(el); });
  }
  $('#modal').classList.add('show');
}
function closeModal() { $('#modal').classList.remove('show'); settingsOpen = false; }
$('#modalClose').onclick = closeModal;
let toastT;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600); }
async function ask(message, okLabel) {
  return invoke ? invoke('confirm', {title: t('confirm.title'), message, okLabel, cancelLabel: t('confirm.cancel')}) : confirm(message);
}
document.addEventListener('click', e => {
  const a = e.target.closest('.modal-body a[href^="http"]'); if (!a) return;
  e.preventDefault();
  if (invoke) invoke('open_url', {url: a.href}).catch(err => toast(t('toast.linkFail', {e: err}))); else window.open(a.href, '_blank', 'noopener');
});

let settingsOpen = false, prefsSection = 'general';
function setPref(k, v) { settings[k] = v; applySettings(); }
function openSettings() {
  $('#modalFoot').hidden = false; renderSettings();
  $('.modal').classList.add('wide'); settingsOpen = true; $('#modal').classList.add('show');
}
function renderSettings() {
  const opt = (v, label, cv) => `<option value="${v}"${v === cv ? ' selected' : ''}>${esc(label)}</option>`;
  const sw = (name, label) => `<label class="switch"><input type="checkbox" data-sw="${name}"${settings[name] ? ' checked' : ''}><span></span>${esc(label)}</label>`;
  const mock = th => `<div class="tc-mock" data-theme="${th}"><div class="tc-bar"><i></i><i></i><i></i><b></b></div><div class="tc-body"><div class="tc-rail"></div>
    <div class="tc-grid">${Array.from({length: 28}, (_, i) => `<i class="${i < 4 ? 'h' : ''}"></i>`).join('')}</div><div class="tc-dock"></div></div></div>`;
  const body = {
    general: `<h3>${t('set.language')}</h3><p class="hint">${t('set.languageHint')}</p>
      <select class="wide-sel" data-sel="lang">${opt('auto', t('a.langAuto'), settings.lang)}${opt('en', 'English', settings.lang)}${opt('de', 'Deutsch', settings.lang)}</select>
      <h3>${t('set.layout')}</h3>${sw('dock', t('set.panels'))}${sw('reopen', t('set.reopen'))}`,
    appearance: `<h3>${t('set.theme')}</h3><div class="theme-grid">` + THEMES.map(th =>
      `<button class="theme-card${settings.theme === th ? ' active' : ''}" data-theme-pick="${th}">${mock(th)}
       <div class="theme-name">${esc(t('theme.' + th))}<span>${settings.theme === th ? '&#10003;' : ''}</span></div></button>`).join('') + `</div>`,
    table: `<h3>${t('set.numbers')}</h3><select class="wide-sel" data-sel="numLocal">${opt('raw', t('set.numRaw'), settings.numLocal ? 'local' : 'raw')}${opt('local', t('set.numLocal'), settings.numLocal ? 'local' : 'raw')}</select>
      <h3>${t('set.layout')}</h3>${sw('compact', t('set.compact'))}`
  };
  $('#modalTitle').textContent = t('set.title');
  $('#modalBody').innerHTML = `<div class="prefs"><nav>${['general', 'appearance', 'table'].map(k =>
    `<button data-sec="${k}" class="${k === prefsSection ? 'active' : ''}">${esc(t('set.' + k))}</button>`).join('')}</nav><section>${body[prefsSection]}</section></div>`;
  $('#modalFoot').innerHTML = `<button class="btn-sm" data-pref="reset">${esc(t('set.reset'))}</button><span class="flex"></span>
    <button class="btn-sm primary" data-pref="done">${esc(t('set.done'))}</button>`;
}
$('#modal').addEventListener('click', e => {
  if (!settingsOpen) return;
  const el = e.target.closest('[data-sec],[data-theme-pick],[data-pref]'); if (!el) return;
  if (el.dataset.sec) prefsSection = el.dataset.sec;
  else if (el.dataset.themePick) settings.theme = el.dataset.themePick;
  else if (el.dataset.pref === 'done') return closeModal();
  else if (el.dataset.pref === 'reset') { settings = {...DEF}; toast(t('set.resetDone')); }
  applySettings(); renderSettings();
});
$('#modal').addEventListener('change', e => {
  if (!settingsOpen) return;
  const d = e.target.dataset;
  if (d.sel) { settings[d.sel] = d.sel === 'numLocal' ? e.target.value === 'local' : e.target.value; applySettings(); renderSettings(); }
  if (d.sw) { settings[d.sw] = e.target.checked; applySettings(); }
});
$('#modal').onmousedown = e => { if (e.target.id === 'modal') closeModal(); };

function applyLanguage() {
  document.documentElement.lang = lang;
  $$('[data-i18n]').forEach(el => el.textContent = t(el.dataset.i18n));
  $$('[data-i18n-ph]').forEach(el => el.placeholder = t(el.dataset.i18nPh));
  buildMenubar(); buildToolbars();
  if (booted) { renderTabs(); renderRecent(); refresh(); updateUI(); syncDisabled(); }
}
let lastView = null;
function applySettings() {
  if (!THEMES.includes(settings.theme)) settings.theme = 'dark';
  const nl = effectiveLang();
  if (nl !== lang) { lang = nl; applyLanguage(); }
  document.documentElement.dataset.theme = settings.theme;
  document.body.classList.toggle('compact', settings.compact);
  $('#work').className = 'work mode-' + settings.view;
  $$('#viewSeg button').forEach(b => b.classList.toggle('active', b.dataset.act === 'view' + settings.view[0].toUpperCase() + settings.view.slice(1)));
  $$('[data-act="toggleFilters"]').forEach(b => b.classList.toggle('active', settings.filters));
  $$('[data-act="toggleCompact"]').forEach(b => b.classList.toggle('active', settings.compact));
  $('#dock').classList.toggle('hidden', !settings.dock);
  $$('#dockTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === settings.dockTab));
  $$('.dpanel').forEach(p => p.classList.toggle('active', p.dataset.panel === settings.dockTab));
  if (booted) { refresh(); syncDisabled(); }
  lastView = settings.view;
  saveState();
}

/* ================= Drag & drop ================= */
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; $('#drop').classList.add('show'); } });
window.addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('#drop').classList.remove('show'); } });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', async e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('#drop').classList.remove('show');
  const list = [];
  for (const f of e.dataTransfer.files) list.push({name: f.name, size: f.size, path: null, bytes: new Uint8Array(await f.arrayBuffer())});
  openFiles(list);
});

/* ================= Native right-click menus (see native.js) ================= */
if (window.Native) {
  const item = (act, extra = {}) => ({id: act, label: t('a.' + act), accel: keyOf(act) || null, enabled: allowed(act), ...extra});
  let ctxTab = -1;
  Native.setProvider(e => {
    const tab = e.target.closest('.tab');
    if (tab) {
      ctxTab = [...$('#tabs').children].indexOf(tab);
      return [{id: 'tab:close', label: t('a.closeTab'), accel: 'Alt+W'}, {id: 'tab:others', label: t('ctx.closeOthers'), enabled: docs.length > 1}];
    }
    const sh = sheet(); if (!sh) return null;
    if (e.target.closest('#chart')) return [item('exportChart')];
    const cell = e.target.closest('.g-cell'), th = e.target.closest('.g-th'), rn = e.target.closest('.g-num');
    if (!cell && !th && !rn) return null;
    stopEdit(true); grid.focus({preventScroll: true});
    const {r0, r1, c0, c1} = selRange(sh.sel), s = sh.sel;
    const clip = [{id: 'ctx:cut', label: t('ctx.cut'), accel: 'Ctrl+X'}, {id: 'ctx:copy', label: t('a.copy'), accel: 'Ctrl+C'}, {id: 'ctx:paste', label: t('ctx.paste'), accel: 'Ctrl+V'}];
    if (cell) {
      const r = +cell.dataset.r, c = +cell.dataset.c;
      if (r < r0 || r > r1 || c < c0 || c > c1) setSel(r, c);
      const v = rawText(sh.rows[sh.view[s.fr]][s.fc]);
      return [...clip, null, item('insertRow'), item('deleteRows'), null, item('insertCol'), item('deleteCol'), item('renameCol'), null,
        item('sortAsc'), item('sortDesc'), {id: 'ctx:filterValue', label: t('ctx.filterValue', {v: v ? (v.length > 28 ? v.slice(0, 28) + '…' : v) : t('ctx.emptyValue')})},
        null, item('clearCells')];
    }
    if (th) {
      const c = +th.dataset.c;
      if (c < c0 || c > c1 || r0 !== 0) { s.ac = s.fc = c; s.ar = 0; s.fr = Math.max(0, sh.view.length - 1); renderGrid(); updateUI(); buildColPanel(); }
      return [item('sortAsc'), item('sortDesc'), null, item('renameCol'), item('insertCol'), item('deleteCol'), null, item('toggleFilters', {checked: settings.filters})];
    }
    const r = +rn.dataset.r;
    if (r < r0 || r > r1) { s.ar = s.fr = r; s.ac = 0; s.fc = sh.cols.length - 1; renderGrid(); updateUI(); }
    return [...clip, null, item('insertRow'), item('deleteRows')];
  });
  Native.setHandler(async id => {
    if (id.startsWith('nf:')) { const c = (numberFormatMenu.list || NUM_FORMATS)[+id.slice(3)]; if (c) applyFormat({nf: c === 'General' ? null : c}); return grid.focus(); }
    if (id === 'tab:close') return closeTab(ctxTab);
    if (id === 'tab:others') { const keep = docs[ctxTab]; for (const x of [...docs]) if (x !== keep) await closeTab(docs.indexOf(x)); return; }
    if (id === 'ctx:copy' || id === 'ctx:cut') {
      const out = selectionTsv(); if (!out) return;
      await Native.clipboardWrite(out.text); toast(t('toast.copied', {n: num(out.n)}));
      if (id === 'ctx:cut') clearCells();
      return;
    }
    if (id === 'ctx:paste') return pasteText(await Native.clipboardRead());
    if (id === 'ctx:filterValue') {
      const sh = sheet(), c = sh.sel.fc;
      sh.filters[c] = '=' + rawText(sh.rows[sh.view[sh.sel.fr]][c]);
      settings.filters = true; applySettings(); refresh(true);
      return;
    }
    run(id);
  });
}

/* ================= Boot ================= */
(async function boot() {
  if (invoke) I18N = await invoke('texts');
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE)); } catch (e) {}
  if (saved) { settings = {...DEF, ...saved.settings}; recent = saved.recent || []; }
  lang = effectiveLang();
  applyLanguage();
  booted = true;
  applySettings(); renderTabs(); renderRecent(); updateUI(); syncDisabled();
  if (invoke) {
    window.__TAURI__.window.getCurrentWindow().onCloseRequested(async ev => {
      saveState();
      if (docs.some(d => d.dirty) && !await ask(t('confirm.quit'), t('confirm.quitOk'))) ev.preventDefault();
    });
    window.__TAURI__.event.listen('open-files', e => openFiles(e.payload));
    for (const path of settings.reopen && saved && saved.open ? saved.open : []) {
      try { await openFileInfo({path, name: path.split(/[\\/]/).pop()}); } catch (e) {}
    }
    if (saved && saved.active) { const i = docs.findIndex(d => d.path === saved.active); if (i >= 0) activate(i); }
    openFiles(await invoke('initial_files'));
  }
})();

// Exposed for automated UI tests in a browser.
window.__dt = {openFiles, A, cur, sheet, serialize, parseFile, doOp, undoRedo, setSel, engineUpdate, refresh, pasteText, buildColPanel, renderChart, chartCfg, chart: () => chart, settings: () => settings};
