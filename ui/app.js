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
const I18N = {
  en: {
    'menu.file': 'File', 'menu.edit': 'Edit', 'menu.data': 'Data', 'menu.format': 'Format', 'menu.view': 'View',
    'a.fmtBold': 'Bold', 'a.fmtItalic': 'Italic', 'a.fmtUnderline': 'Underline', 'a.fmtStrike': 'Strikethrough', 'a.fmtFontColor': 'Text Color…', 'a.fmtFill': 'Fill Color…',
    'a.fmtAlignLeft': 'Align Left', 'a.fmtAlignCenter': 'Center', 'a.fmtAlignRight': 'Align Right', 'a.fmtWrap': 'Wrap Text', 'a.fmtBorders': 'Borders',
    'a.fmtNoFill': 'No Fill', 'a.fmtClear': 'Clear Formatting', 'ui.numFormat': 'Number format', 'nf.general': 'General', 'nf.text': 'Text', 'nf.custom': 'Custom: {c}',
    'ui.fmtOnlyExcel': 'Formatting is kept in Excel workbooks (.xlsx). Save as Excel to use it.', 'menu.settings': 'Settings', 'menu.help': 'Help',
    'menu.language': 'Language', 'menu.theme': 'Theme',
    'a.openFile': 'Open…', 'a.newTable': 'New Table', 'a.save': 'Save', 'a.saveAs': 'Save As…', 'a.exportAs': 'Export…', 'a.closeTab': 'Close Tab',
    'a.undo': 'Undo', 'a.redo': 'Redo', 'a.copy': 'Copy', 'a.selectAll': 'Select All', 'a.editCell': 'Edit Cell', 'a.clearCells': 'Clear Cells',
    'a.find': 'Search Rows', 'a.insertRow': 'Insert Row Below', 'a.deleteRows': 'Delete Rows', 'a.insertCol': 'Insert Column Right',
    'a.deleteCol': 'Delete Columns', 'a.renameCol': 'Rename Column…', 'a.sortAsc': 'Sort Ascending', 'a.sortDesc': 'Sort Descending',
    'a.clearView': 'Clear Sort and Filters', 'a.toggleFilters': 'Column Filters', 'a.toggleHeader': 'First Row Is Header',
    'a.viewTable': 'Table Only', 'a.viewSplit': 'Table and Chart', 'a.viewChart': 'Chart Only', 'a.togglePanels': 'Panels',
    'a.toggleCompact': 'Compact Rows', 'a.exportChart': 'Save Chart as PNG…', 'a.settings': 'Preferences…',
    'a.langAuto': 'System language', 'a.langEn': 'English', 'a.langDe': 'Deutsch',
    'a.themeDark': 'Dark', 'a.themeLight': 'Light', 'a.themeGithub': 'GitHub', 'a.themeGithubDark': 'GitHub Dark',
    'a.shortcuts': 'Keyboard Shortcuts', 'a.about': 'About Data Studio',
    'theme.dark': 'Dark', 'theme.light': 'Light', 'theme.github': 'GitHub', 'theme.github-dark': 'GitHub Dark',
    'ui.save': 'Save', 'ui.searchRows': 'Search all rows…', 'ui.column': 'Column', 'ui.chart': 'Chart', 'ui.properties': 'Properties',
    'ui.table': 'Table', 'ui.split': 'Split', 'ui.saveChart': 'Save PNG',
    'ui.emptyTitle': 'Open a data file to get started',
    'ui.emptyHint': 'CSV, TSV, JSON, JSON Lines or Excel. Drop files here or use File → Open (Ctrl+O).',
    'ui.recent': 'Recent files', 'ui.drop': 'Drop data files to open them', 'ui.openTip': 'Open file',
    'ui.rows': '{n} rows', 'ui.rowsFiltered': '{n} of {total} rows', 'ui.cols': '{n} columns', 'ui.cell': 'Row {r} · {c}',
    'ui.selStats': 'Count {n}', 'ui.selSum': 'Sum {v}', 'ui.selAvg': 'Average {v}',
    'ui.noColumn': 'Click a cell or column header to see statistics for that column.', 'ui.noRows': 'No rows match the current search and filters.',
    'ui.type': 'Type', 'ui.values': 'Values', 'ui.empty': 'Empty', 'ui.unique': 'Unique', 'ui.min': 'Minimum', 'ui.max': 'Maximum',
    'ui.sum': 'Sum', 'ui.mean': 'Average', 'ui.median': 'Median', 'ui.top': 'Most common', 'ui.earliest': 'Earliest', 'ui.latest': 'Latest',
    'ui.shownRows': 'Based on the {n} rows shown.',
    'type.number': 'Number', 'type.text': 'Text', 'type.date': 'Date', 'type.bool': 'Yes/No',
    'tshort.number': '123', 'tshort.text': 'Abc', 'tshort.date': 'Date', 'tshort.bool': 'Y/N',
    'ui.file': 'File', 'ui.format': 'Format', 'ui.delimiter': 'Separator', 'ui.encoding': 'Encoding', 'ui.sheets': 'Sheets',
    'ui.size': 'File size', 'ui.path': 'Location', 'ui.headerRow': 'First row contains column names', 'ui.table2': 'Table',
    'delim.,': 'Comma', 'delim.;': 'Semicolon', 'delim.\t': 'Tab', 'delim.|': 'Pipe',
    'ui.chartType': 'Chart type', 'chart.bar': 'Bar', 'chart.line': 'Line', 'chart.pie': 'Pie', 'chart.scatter': 'Scatter',
    'ui.xCol': 'Categories (X axis)', 'ui.yCols': 'Values (Y axis)', 'ui.agg': 'Combine equal categories',
    'agg.none': 'Don’t combine', 'agg.sum': 'Sum', 'agg.avg': 'Average', 'agg.count': 'Count rows', 'ui.limit': 'Show at most',
    'ui.chartNeedNumber': 'Pick at least one number column for the values in the Chart panel.', 'ui.byX': 'by {x}',
    'ui.exportTitle': 'Export', 'ui.saveAsTitle': 'Save As', 'ui.onlyVisible': 'Only the rows shown (current search, filters and sort)',
    'ui.export': 'Export', 'ui.cancel': 'Cancel', 'ui.ok': 'OK', 'ui.renameTitle': 'Rename column', 'ui.newColName': 'Column {n}',
    'ui.untitled': 'Untitled', 'ui.sortTip': 'Sort — click to switch between ascending, descending and off', 'ui.filterPh': 'Filter…',
    'ui.filterHelp': 'Text to find, or for numbers: >10, <5, 10..20, =3. Start with ! to exclude.', 'ui.notSaved': 'Unsaved changes',
    'fmt.csv': 'CSV (comma)', 'fmt.csvD': 'Works in almost every app', 'fmt.csvSemi': 'CSV for Excel (semicolon)',
    'fmt.csvSemiD': 'Opens correctly in German Excel', 'fmt.tsv': 'TSV (tab)', 'fmt.tsvD': 'Easy to paste anywhere',
    'fmt.json': 'JSON', 'fmt.jsonD': 'List of objects', 'fmt.jsonl': 'JSON Lines', 'fmt.jsonlD': 'One object per line',
    'fmt.xlsx': 'Excel workbook', 'fmt.xlsxD': '.xlsx with all sheets', 'fmt.md': 'Markdown table', 'fmt.mdD': 'For Markdown Studio',
    'st.dirty': 'Unsaved changes', 'st.saved': 'Saved',
    'toast.saved': 'Saved {name}', 'toast.exported': 'Exported {name}', 'toast.openFail': 'Could not open {name}: {e}',
    'toast.saveFail': 'Save failed: {e}', 'toast.skipped': 'Skipped {name} (unsupported file type)', 'toast.missing': 'File not found: {name}',
    'toast.copied': 'Copied {n} cells', 'toast.pasted': 'Pasted {n} cells', 'toast.lastCol': 'A table needs at least one column.',
    'toast.linkFail': 'Could not open link: {e}', 'toast.tooBig': 'Copy is limited to 1,000,000 cells.',
    'confirm.title': 'Unsaved changes', 'confirm.close': '“{name}” has unsaved changes. Close it anyway?',
    'confirm.quit': 'Some files have unsaved changes. Quit anyway?', 'confirm.ok': 'Close anyway', 'confirm.quitOk': 'Quit anyway',
    'confirm.cancel': 'Cancel',
    'set.title': 'Settings', 'set.general': 'General', 'set.appearance': 'Appearance', 'set.table': 'Table',
    'set.language': 'Language', 'set.languageHint': 'Language of menus, panels and messages.', 'set.layout': 'Layout',
    'set.panels': 'Show panels on the right', 'set.reopen': 'Reopen the files from last time on start', 'set.theme': 'Theme',
    'set.compact': 'Compact rows (fit more on screen)', 'set.numbers': 'Show numbers', 'set.numRaw': 'Exactly as in the file',
    'set.numLocal': 'Formatted for my language (1,234.5 / 1.234,5)', 'set.reset': 'Reset to defaults', 'set.done': 'Done',
    'set.resetDone': 'Settings reset to defaults',
    'about.p1': '<b>Data Studio</b> is part of the Studio family: view, filter, sort, chart, edit and convert CSV, JSON and Excel files.',
    'about.p2': 'Built with Rust (Tauri), <a href="https://sheetjs.com">SheetJS</a>, <a href="https://www.papaparse.com">Papa Parse</a> and <a href="https://www.chartjs.org">Chart.js</a>.',
    'about.p3': 'Everything runs on your computer; files are never uploaded.', 'about.version': 'Version {v}',
    'sc.grid': 'In the table', 'sc.move': 'Move', 'sc.moveKey': 'Arrow keys, Tab, Page Up/Down', 'sc.extend': 'Extend selection',
    'sc.extendKey': 'Shift + arrows or click', 'sc.edit': 'Edit a cell', 'sc.editKey': 'Type, F2 or double-click',
    'sc.paste': 'Paste from Excel', 'sc.pasteKey': 'Ctrl+V', 'sc.width': 'Column width', 'sc.widthKey': 'Drag the header edge',
    'ctx.closeOthers': 'Close Other Tabs', 'ctx.cut': 'Cut', 'ctx.paste': 'Paste', 'ctx.filterValue': 'Show Only “{v}”', 'ctx.emptyValue': '(empty)',
    'ui.newTitle': 'New table', 'ui.create': 'Create', 'ui.new_xlsx': 'Keeps formulas and several sheets; Excel opens it directly',
    'ui.new_csv': 'Plain text that works everywhere; formulas are stored as text and calculated by Excel', 'ui.new_json': 'A list of records for programs and web apps; formulas are saved as their results',
    'ui.fxPh': 'Value or formula, e.g. =SUM(A1:A10)'
  },
  de: {
    'menu.file': 'Datei', 'menu.edit': 'Bearbeiten', 'menu.data': 'Daten', 'menu.format': 'Format', 'menu.view': 'Ansicht',
    'a.fmtBold': 'Fett', 'a.fmtItalic': 'Kursiv', 'a.fmtUnderline': 'Unterstrichen', 'a.fmtStrike': 'Durchgestrichen', 'a.fmtFontColor': 'Schriftfarbe…', 'a.fmtFill': 'Füllfarbe…',
    'a.fmtAlignLeft': 'Linksbündig', 'a.fmtAlignCenter': 'Zentriert', 'a.fmtAlignRight': 'Rechtsbündig', 'a.fmtWrap': 'Zeilenumbruch', 'a.fmtBorders': 'Rahmenlinien',
    'a.fmtNoFill': 'Keine Füllung', 'a.fmtClear': 'Formatierung löschen', 'ui.numFormat': 'Zahlenformat', 'nf.general': 'Standard', 'nf.text': 'Text', 'nf.custom': 'Benutzerdefiniert: {c}',
    'ui.fmtOnlyExcel': 'Formatierung wird in Excel-Arbeitsmappen (.xlsx) gespeichert. Als Excel speichern, um sie zu nutzen.', 'menu.settings': 'Einstellungen', 'menu.help': 'Hilfe',
    'menu.language': 'Sprache', 'menu.theme': 'Design',
    'a.openFile': 'Öffnen…', 'a.newTable': 'Neue Tabelle', 'a.save': 'Speichern', 'a.saveAs': 'Speichern unter…', 'a.exportAs': 'Exportieren…',
    'a.closeTab': 'Tab schließen', 'a.undo': 'Rückgängig', 'a.redo': 'Wiederholen', 'a.copy': 'Kopieren', 'a.selectAll': 'Alles auswählen',
    'a.editCell': 'Zelle bearbeiten', 'a.clearCells': 'Zellen leeren', 'a.find': 'Zeilen durchsuchen', 'a.insertRow': 'Zeile darunter einfügen',
    'a.deleteRows': 'Zeilen löschen', 'a.insertCol': 'Spalte rechts einfügen', 'a.deleteCol': 'Spalten löschen', 'a.renameCol': 'Spalte umbenennen…',
    'a.sortAsc': 'Aufsteigend sortieren', 'a.sortDesc': 'Absteigend sortieren', 'a.clearView': 'Sortierung und Filter zurücksetzen',
    'a.toggleFilters': 'Spaltenfilter', 'a.toggleHeader': 'Erste Zeile ist Kopfzeile',
    'a.viewTable': 'Nur Tabelle', 'a.viewSplit': 'Tabelle und Diagramm', 'a.viewChart': 'Nur Diagramm', 'a.togglePanels': 'Bedienfelder',
    'a.toggleCompact': 'Kompakte Zeilen', 'a.exportChart': 'Diagramm als PNG speichern…', 'a.settings': 'Einstellungen…',
    'a.langAuto': 'Systemsprache', 'a.langEn': 'English', 'a.langDe': 'Deutsch',
    'a.themeDark': 'Dunkel', 'a.themeLight': 'Hell', 'a.themeGithub': 'GitHub', 'a.themeGithubDark': 'GitHub Dunkel',
    'a.shortcuts': 'Tastenkürzel', 'a.about': 'Über Data Studio',
    'theme.dark': 'Dunkel', 'theme.light': 'Hell', 'theme.github': 'GitHub', 'theme.github-dark': 'GitHub Dunkel',
    'ui.save': 'Speichern', 'ui.searchRows': 'Alle Zeilen durchsuchen…', 'ui.column': 'Spalte', 'ui.chart': 'Diagramm',
    'ui.properties': 'Eigenschaften', 'ui.table': 'Tabelle', 'ui.split': 'Geteilt', 'ui.saveChart': 'PNG speichern',
    'ui.emptyTitle': 'Öffne eine Datendatei, um loszulegen',
    'ui.emptyHint': 'CSV, TSV, JSON, JSON Lines oder Excel. Dateien hier ablegen oder Datei → Öffnen (Strg+O) verwenden.',
    'ui.recent': 'Zuletzt geöffnet', 'ui.drop': 'Datendateien hier ablegen, um sie zu öffnen', 'ui.openTip': 'Datei öffnen',
    'ui.rows': '{n} Zeilen', 'ui.rowsFiltered': '{n} von {total} Zeilen', 'ui.cols': '{n} Spalten', 'ui.cell': 'Zeile {r} · {c}',
    'ui.selStats': 'Anzahl {n}', 'ui.selSum': 'Summe {v}', 'ui.selAvg': 'Mittelwert {v}',
    'ui.noColumn': 'Klicke auf eine Zelle oder einen Spaltenkopf, um die Statistik dieser Spalte zu sehen.',
    'ui.noRows': 'Keine Zeile passt zur aktuellen Suche und den Filtern.',
    'ui.type': 'Typ', 'ui.values': 'Werte', 'ui.empty': 'Leer', 'ui.unique': 'Eindeutig', 'ui.min': 'Minimum', 'ui.max': 'Maximum',
    'ui.sum': 'Summe', 'ui.mean': 'Mittelwert', 'ui.median': 'Median', 'ui.top': 'Häufigste Werte', 'ui.earliest': 'Frühestes',
    'ui.latest': 'Spätestes', 'ui.shownRows': 'Bezogen auf die {n} angezeigten Zeilen.',
    'type.number': 'Zahl', 'type.text': 'Text', 'type.date': 'Datum', 'type.bool': 'Ja/Nein',
    'tshort.number': '123', 'tshort.text': 'Abc', 'tshort.date': 'Datum', 'tshort.bool': 'J/N',
    'ui.file': 'Datei', 'ui.format': 'Format', 'ui.delimiter': 'Trennzeichen', 'ui.encoding': 'Kodierung', 'ui.sheets': 'Tabellenblätter',
    'ui.size': 'Dateigröße', 'ui.path': 'Speicherort', 'ui.headerRow': 'Erste Zeile enthält die Spaltennamen', 'ui.table2': 'Tabelle',
    'delim.,': 'Komma', 'delim.;': 'Semikolon', 'delim.\t': 'Tabulator', 'delim.|': 'Senkrechter Strich',
    'ui.chartType': 'Diagrammtyp', 'chart.bar': 'Balken', 'chart.line': 'Linie', 'chart.pie': 'Kreis', 'chart.scatter': 'Punkte',
    'ui.xCol': 'Kategorien (X-Achse)', 'ui.yCols': 'Werte (Y-Achse)', 'ui.agg': 'Gleiche Kategorien zusammenfassen',
    'agg.none': 'Nicht zusammenfassen', 'agg.sum': 'Summe', 'agg.avg': 'Mittelwert', 'agg.count': 'Zeilen zählen', 'ui.limit': 'Höchstens anzeigen',
    'ui.chartNeedNumber': 'Wähle im Diagramm-Bedienfeld mindestens eine Zahlenspalte für die Werte.', 'ui.byX': 'nach {x}',
    'ui.exportTitle': 'Exportieren', 'ui.saveAsTitle': 'Speichern unter', 'ui.onlyVisible': 'Nur die angezeigten Zeilen (aktuelle Suche, Filter und Sortierung)',
    'ui.export': 'Exportieren', 'ui.cancel': 'Abbrechen', 'ui.ok': 'OK', 'ui.renameTitle': 'Spalte umbenennen', 'ui.newColName': 'Spalte {n}',
    'ui.untitled': 'Unbenannt', 'ui.sortTip': 'Sortieren – Klick wechselt zwischen aufsteigend, absteigend und aus', 'ui.filterPh': 'Filter…',
    'ui.filterHelp': 'Gesuchter Text, oder bei Zahlen: >10, <5, 10..20, =3. Mit ! am Anfang ausschließen.',
    'ui.notSaved': 'Ungespeicherte Änderungen',
    'fmt.csv': 'CSV (Komma)', 'fmt.csvD': 'Funktioniert in fast jeder App', 'fmt.csvSemi': 'CSV für Excel (Semikolon)',
    'fmt.csvSemiD': 'Öffnet korrekt im deutschen Excel', 'fmt.tsv': 'TSV (Tabulator)', 'fmt.tsvD': 'Lässt sich überall einfügen',
    'fmt.json': 'JSON', 'fmt.jsonD': 'Liste von Objekten', 'fmt.jsonl': 'JSON Lines', 'fmt.jsonlD': 'Ein Objekt pro Zeile',
    'fmt.xlsx': 'Excel-Arbeitsmappe', 'fmt.xlsxD': '.xlsx mit allen Blättern', 'fmt.md': 'Markdown-Tabelle', 'fmt.mdD': 'Für Markdown Studio',
    'st.dirty': 'Ungespeicherte Änderungen', 'st.saved': 'Gespeichert',
    'toast.saved': '{name} gespeichert', 'toast.exported': '{name} exportiert', 'toast.openFail': '{name} konnte nicht geöffnet werden: {e}',
    'toast.saveFail': 'Speichern fehlgeschlagen: {e}', 'toast.skipped': '{name} übersprungen (Dateityp nicht unterstützt)',
    'toast.missing': 'Datei nicht gefunden: {name}', 'toast.copied': '{n} Zellen kopiert', 'toast.pasted': '{n} Zellen eingefügt',
    'toast.lastCol': 'Eine Tabelle braucht mindestens eine Spalte.', 'toast.linkFail': 'Link konnte nicht geöffnet werden: {e}',
    'toast.tooBig': 'Kopieren ist auf 1.000.000 Zellen begrenzt.',
    'confirm.title': 'Ungespeicherte Änderungen', 'confirm.close': '„{name}“ hat ungespeicherte Änderungen. Trotzdem schließen?',
    'confirm.quit': 'Einige Dateien haben ungespeicherte Änderungen. Trotzdem beenden?', 'confirm.ok': 'Trotzdem schließen',
    'confirm.quitOk': 'Trotzdem beenden', 'confirm.cancel': 'Abbrechen',
    'set.title': 'Einstellungen', 'set.general': 'Allgemein', 'set.appearance': 'Darstellung', 'set.table': 'Tabelle',
    'set.language': 'Sprache', 'set.languageHint': 'Sprache der Menüs, Bedienfelder und Meldungen.', 'set.layout': 'Layout',
    'set.panels': 'Bedienfelder rechts anzeigen', 'set.reopen': 'Beim Start die zuletzt geöffneten Dateien wieder öffnen', 'set.theme': 'Design',
    'set.compact': 'Kompakte Zeilen (mehr auf einen Blick)', 'set.numbers': 'Zahlen anzeigen', 'set.numRaw': 'Genau wie in der Datei',
    'set.numLocal': 'Für meine Sprache formatiert (1.234,5)', 'set.reset': 'Auf Standard zurücksetzen', 'set.done': 'Fertig',
    'set.resetDone': 'Einstellungen zurückgesetzt',
    'about.p1': '<b>Data Studio</b> gehört zur Studio-Familie: CSV-, JSON- und Excel-Dateien ansehen, filtern, sortieren, als Diagramm darstellen, bearbeiten und umwandeln.',
    'about.p2': 'Gebaut mit Rust (Tauri), <a href="https://sheetjs.com">SheetJS</a>, <a href="https://www.papaparse.com">Papa Parse</a> und <a href="https://www.chartjs.org">Chart.js</a>.',
    'about.p3': 'Alles läuft auf deinem Computer; Dateien werden nie hochgeladen.', 'about.version': 'Version {v}',
    'sc.grid': 'In der Tabelle', 'sc.move': 'Bewegen', 'sc.moveKey': 'Pfeiltasten, Tab, Bild auf/ab', 'sc.extend': 'Auswahl erweitern',
    'sc.extendKey': 'Umschalt + Pfeile oder Klick', 'sc.edit': 'Zelle bearbeiten', 'sc.editKey': 'Lostippen, F2 oder Doppelklick',
    'sc.paste': 'Aus Excel einfügen', 'sc.pasteKey': 'Strg+V', 'sc.width': 'Spaltenbreite', 'sc.widthKey': 'Kante im Spaltenkopf ziehen',
    'ctx.closeOthers': 'Andere Tabs schließen', 'ctx.cut': 'Ausschneiden', 'ctx.paste': 'Einfügen', 'ctx.filterValue': 'Nur „{v}“ anzeigen',
    'ctx.emptyValue': '(leer)',
    'ui.newTitle': 'Neue Tabelle', 'ui.create': 'Erstellen', 'ui.new_xlsx': 'Behält Formeln und mehrere Blätter; Excel öffnet sie direkt',
    'ui.new_csv': 'Reiner Text, funktioniert überall; Formeln werden als Text gespeichert und von Excel berechnet', 'ui.new_json': 'Eine Liste von Datensätzen für Programme und Web-Apps; Formeln werden als Ergebnis gespeichert',
    'ui.fxPh': 'Wert oder Formel, z. B. =SUMME(A1:A10)'
  }
};
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
const DATE_ISO = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const DATE_DE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?: (\d{1,2}):(\d{2}))?$/;
const BOOL = /^(true|false|yes|no|ja|nein|wahr|falsch)$/i;
const isEmpty = v => v === null || v === undefined || v === '';
function toNumber(v, style = 'en') {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean' || v instanceof Date || typeof v !== 'string') return NaN;
  const s = v.trim();
  if (!s || s === '-' || s === '+' || s === '.') return NaN;
  if (style === 'de') return NUM_DE.test(s) ? +s.replace(/\./g, '').replace(',', '.') : NaN;
  return NUM_EN.test(s) ? +s.replace(/,/g, '') : NaN;
}
function toTime(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v !== 'string') return NaN;
  const s = v.trim();
  if (DATE_ISO.test(s)) return Date.parse(s.length === 10 ? s + 'T00:00:00' : s.replace(' ', 'T'));
  const m = DATE_DE.exec(s);
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime() : NaN;
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
function calcOf(sh) {
  if (!sh.calc) sh.calc = Formula.makeEvaluator((r, c) => sh.rows[r] && sh.rows[r][c], () => sh.rows.length, () => sh.cols.length,
    (raw, c) => plainValue(raw, sh.cols[c]));
  return sh.calc;
}
/* What a cell holds after calculation: formulas give their result, everything else is returned as stored. */
const cellValue = (sh, r, c) => { const raw = sh.rows[r][c]; return Formula.isFormula(raw) ? calcOf(sh).value(r, c) : raw; };
function displayCell(sh, r, c) {
  const raw = sh.rows[r][c], col = sh.cols[c];
  if (!Formula.isFormula(raw)) return display(raw, col);
  const v = calcOf(sh).value(r, c);
  if (Formula.isError(v)) return v.code;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (settings.numLocal) return v.toLocaleString(lang, {maximumFractionDigits: 10});
    const s = String(+v.toPrecision(15));
    return col.numStyle === 'de' ? s.replace('.', ',') : s;
  }
  return display(v, col);
}
/* Column type: sampled, so huge files stay fast. Formula cells count with their result. */
function detectType(sh, c) {
  const col = sh.cols[c], n = sh.rows.length, step = Math.max(1, Math.floor(n / 3000));
  const vals = [];
  for (let i = 0; i < n && vals.length < 3000; i += step) {
    const v = cellValue(sh, i, c);
    if (!isEmpty(v) && !Formula.isError(v)) vals.push(v);
  }
  col.numStyle = 'en';
  if (!vals.length) { col.type = 'text'; return; }
  if (vals.every(v => typeof v === 'number')) { col.type = 'number'; return; }
  if (vals.every(v => v instanceof Date)) { col.type = 'date'; return; }
  if (vals.every(v => typeof v === 'boolean' || (typeof v === 'string' && BOOL.test(v.trim())))) { col.type = 'bool'; return; }
  const strs = vals.every(v => typeof v === 'string' || typeof v === 'number');
  if (strs && vals.every(v => Number.isFinite(toNumber(v, 'en')))) { col.type = 'number'; return; }
  if (strs && vals.every(v => Number.isFinite(toNumber(v, 'de')))) { col.type = 'number'; col.numStyle = 'de'; return; }
  if (vals.every(v => Number.isFinite(toTime(v)))) { col.type = 'date'; return; }
  col.type = 'text';
}
const detectAll = sh => sh.cols.forEach((_, c) => detectType(sh, c));
function sortKey(v, col) {
  if (isEmpty(v)) return null;
  if (col.type === 'number') { const n = toNumber(v, col.numStyle); return Number.isFinite(n) ? n : rawText(v).toLowerCase(); }
  if (col.type === 'date') { const n = toTime(v); return Number.isFinite(n) ? n : rawText(v).toLowerCase(); }
  return rawText(v);
}
const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
function cmpKeys(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return collator.compare(a, b);
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
  $$('#fmtBtns [data-act]').forEach(b => { b.disabled = !ok; b.title = tip(b.dataset.act) + (ok ? '' : ' — ' + t('ui.fmtOnlyExcel')); });
  for (const [a, k] of [['fmtBold', 'b'], ['fmtItalic', 'i'], ['fmtUnderline', 'u'], ['fmtWrap', 'wrap']]) $$(`[data-act="${a}"]`).forEach(b => b.classList.toggle('active', !!st[k]));
  for (const [a, v] of [['fmtAlignLeft', 'left'], ['fmtAlignCenter', 'center'], ['fmtAlignRight', 'right']]) $$(`[data-act="${a}"]`).forEach(b => b.classList.toggle('active', st.ha === v));
  const sel = $('#nfSel'); if (!sel) return;
  sel.disabled = !ok;
  const code = st.nf || 'General';
  if (![...sel.options].some(o => o.value === code)) { const o = document.createElement('option'); o.value = code; o.textContent = t('nf.custom', {c: code}); o.dataset.custom = 1; sel.append(o); }
  sel.value = code;
  $('#fcBar').style.background = st.fc || 'var(--text)'; $('#bgBar').style.background = st.bg || 'transparent';
}
const nfLabel = code => code === 'General' ? t('nf.general') : code === '@' ? t('nf.text') : (XFormat.number(code.includes('y') || code.includes('h') ? new Date(2026, 9, 10, 14, 30) : code.includes('%') ? 0.255 : 1234.5, code, lang === 'de' ? 'de-DE' : 'en-US') || code);

/* ================= Reading files ================= */
const SHEET_EXT = ['xlsx', 'xlsm', 'xls', 'ods'], TEXT_EXT = ['csv', 'tsv', 'tab', 'txt', 'json', 'jsonl', 'ndjson'];
const extOf = name => (name.split('.').pop() || '').toLowerCase();
function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function decodeText(bytes) {
  let bom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
  const body = bom ? bytes.subarray(3) : bytes;
  try { return {text: new TextDecoder('utf-8', {fatal: true}).decode(body), encoding: bom ? 'UTF-8 (BOM)' : 'UTF-8', bom}; }
  catch (e) { return {text: new TextDecoder('windows-1252').decode(body), encoding: 'Windows-1252', bom: false}; }
}
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
  detectAll(sh); measureCols(sh); recompute(sh);
  return sh;
}
function flatten(o, prefix = '', out = {}, depth = 0) {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 3) flatten(v, key, out, depth + 1);
    else out[key] = Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : v;
  }
  return out;
}
function jsonToAoa(data) {
  const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
  const objectsToAoa = list => {
    const flat = list.map(o => flatten(o)), keys = [], seen = new Set();
    for (const o of flat) for (const k of Object.keys(o)) if (!seen.has(k)) { seen.add(k); keys.push(k); if (keys.length >= 2000) break; }
    return [keys, ...flat.map(o => keys.map(k => o[k] ?? ''))];
  };
  if (Array.isArray(data)) {
    if (data.length && data.every(isObj)) return objectsToAoa(data);
    if (data.length && data.every(Array.isArray)) return data.every((r, i) => i > 0 || r.every(v => typeof v === 'string')) ? data : [data[0].map((_, i) => colName(i)), ...data];
    return [['value'], ...data.map(v => [isObj(v) || Array.isArray(v) ? JSON.stringify(v) : v])];
  }
  if (isObj(data)) {
    const vals = Object.values(data);
    if (vals.length && vals.every(Array.isArray) && vals.every(a => a.length === vals[0].length) && vals.every(a => a.every(v => !isObj(v)))) {
      const keys = Object.keys(data);
      return [keys, ...vals[0].map((_, i) => keys.map(k => data[k][i]))];
    }
    if (vals.length && vals.every(isObj)) return objectsToAoa(Object.entries(data).map(([k, v]) => ({key: k, ...v})));
    const arrKey = Object.keys(data).find(k => Array.isArray(data[k]) && data[k].length && isObj(data[k][0]));
    if (arrKey) return objectsToAoa(data[arrKey]);
    return [['key', 'value'], ...Object.entries(flatten(data))];
  }
  return [['value'], [data]];
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
  if (SHEET_EXT.includes(ext)) {
    const wb = XLSX.read(bytes, {type: 'array', cellDates: true, cellFormula: true});
    const sheets = wb.SheetNames.map(n => {
      const ws = wb.Sheets[n], cells = Object.keys(ws).filter(k => k[0] !== '!');
      const formulas = cells.filter(k => ws[k].f);
      // With formulas, keep blank rows so row numbers (and so references) stay as in Excel.
      const aoa = XLSX.utils.sheet_to_json(ws, {header: 1, raw: true, defval: '', blankrows: formulas.length > 0});
      if (formulas.length && ws['!ref']) {
        const start = XLSX.utils.decode_range(ws['!ref']).s;
        for (const k of formulas) {
          const {r, c} = XLSX.utils.decode_cell(k);
          (aoa[r - start.r] = aoa[r - start.r] || [])[c - start.c] = '=' + ws[k].f;
        }
      }
      return makeSheet(n, aoa, true, true);
    });
    return {format: ext, sheets, encoding: '', delimiter: '', bom: false};
  }
  const {text, encoding, bom} = decodeText(bytes);
  if (ext === 'json') {
    try { return {format: 'json', sheets: [makeSheet(base, jsonToAoa(JSON.parse(text)))], encoding, bom, delimiter: ''}; }
    catch (e) { if (!/^\s*\{/.test(text)) throw e; }   // maybe JSON Lines with a .json name
  }
  if (ext === 'json' || ext === 'jsonl' || ext === 'ndjson') {
    const items = text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
    return {format: 'jsonl', sheets: [makeSheet(base, jsonToAoa(items))], encoding, bom, delimiter: ''};
  }
  const res = Papa.parse(text, {delimiter: ext === 'tsv' || ext === 'tab' ? '\t' : '', skipEmptyLines: 'greedy'});
  const delimiter = res.meta.delimiter || ',';
  return {format: ext === 'tab' ? 'tsv' : ext, sheets: [makeSheet(base, res.data, true, true)], encoding, bom, delimiter};
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
function makeFilter(sh, c, expr) {
  let s = expr.trim(), neg = false;
  if (s.startsWith('!')) { neg = true; s = s.slice(1).trim(); }
  const col = sh.cols[c], numeric = col.type === 'number' || col.type === 'date';
  const val = v => col.type === 'date' ? toTime(v) : toNumber(v, col.numStyle);
  const parse = x => col.type === 'date' ? toTime(x.trim()) : (Number.isFinite(toNumber(x.trim(), col.numStyle)) ? toNumber(x.trim(), col.numStyle) : toNumber(x.trim(), 'en'));
  let test;
  let m;
  if (numeric && (m = /^(>=|<=|>|<|=)\s*(.+)$/.exec(s)) && Number.isFinite(parse(m[2]))) {
    const x = parse(m[2]), op = m[1];
    test = v => { const n = val(v); return Number.isFinite(n) && (op === '>' ? n > x : op === '<' ? n < x : op === '>=' ? n >= x : op === '<=' ? n <= x : n === x); };
  } else if (numeric && (m = /^(.+?)\s*\.\.\s*(.+)$/.exec(s)) && Number.isFinite(parse(m[1])) && Number.isFinite(parse(m[2]))) {
    const a = parse(m[1]), b = parse(m[2]);
    test = v => { const n = val(v); return Number.isFinite(n) && n >= a && n <= b; };
  } else if (s.startsWith('=')) {
    const x = s.slice(1).trim().toLowerCase();
    test = v => rawText(v).toLowerCase() === x;
  } else {
    const x = s.toLowerCase();
    test = v => rawText(v).toLowerCase().includes(x);
  }
  return i => test(cellValue(sh, i, c)) !== neg;
}
function recompute(sh) {
  const q = sh.query.trim().toLowerCase();
  const fs = Object.entries(sh.filters).filter(([c, v]) => v && v.trim() && sh.cols[+c]).map(([c, v]) => makeFilter(sh, +c, v));
  const idx = [];
  for (let i = 0; i < sh.rows.length; i++) {
    if (q && !sh.rows[i].some((_, c) => { const v = cellValue(sh, i, c); return !isEmpty(v) && rawText(v).toLowerCase().includes(q); })) continue;
    if (fs.length && !fs.every(f => f(i))) continue;
    idx.push(i);
  }
  if (sh.sort.dir && sh.cols[sh.sort.c]) {
    const c = sh.sort.c, col = sh.cols[c], dir = sh.sort.dir, keys = new Map();
    for (const i of idx) keys.set(i, sortKey(cellValue(sh, i, c), col));
    idx.sort((a, b) => {
      const ka = keys.get(a), kb = keys.get(b);
      if (ka === null) return kb === null ? a - b : 1;
      if (kb === null) return -1;
      return cmpKeys(ka, kb) * dir || a - b;
    });
  }
  sh.view = idx;
  const s = sh.sel, maxR = Math.max(0, idx.length - 1), maxC = sh.cols.length - 1;
  s.ar = clamp(s.ar, 0, maxR); s.fr = clamp(s.fr, 0, maxR); s.ac = clamp(s.ac, 0, maxC); s.fc = clamp(s.fc, 0, maxC);
}

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
  if (recalc) recompute(sh);
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
  if (sh.calc) sh.calc.reset();   // any change can affect formula results
  d.dirty = d.history.length !== d.cleanDepth;
  const cols = new Set();
  const collect = o => o.t === 'cells' ? o.ch.forEach(x => cols.add(x.c)) : o.t === 'batch' ? o.ops.forEach(collect) : null;
  collect(op);
  if (op.t === 'cells') cols.forEach(c => detectType(sh, c)); else if (op.t !== 'fmt') detectAll(sh);
  if (op.t === 'col+' || op.t === 'col-' || op.t === 'header') measureCols(sh);
  refresh(forceRecalc || structural(op));
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
function buildColPanel() {
  const box = $('#colPanel'), sh = sheet();
  if (!sh || settings.dockTab !== 'column') { if (!sh) box.innerHTML = ''; return; }
  const c = sh.sel.fc, col = sh.cols[c];
  if (!col) { box.innerHTML = `<div class="empty">${esc(t('ui.noColumn'))}</div>`; return; }
  const vals = sh.view.map(i => cellValue(sh, i, c)), filled = vals.filter(v => !isEmpty(v) && !Formula.isError(v));
  const counts = new Map();
  for (const v of filled) { const k = rawText(v); counts.set(k, (counts.get(k) || 0) + 1); }
  const kv = (k, v) => `<div class="kv"><span>${esc(t(k))}</span><b title="${esc(v)}">${esc(v)}</b></div>`;
  let h = `<div class="col-title" title="${esc(col.name)}">${esc(col.name)}</div>
    ${kv('ui.type', t('type.' + col.type))}${kv('ui.values', num(filled.length))}${kv('ui.empty', num(vals.length - filled.length))}${kv('ui.unique', num(counts.size))}`;
  if (col.type === 'number') {
    const ns = filled.map(v => toNumber(v, col.numStyle)).filter(Number.isFinite).sort((a, b) => a - b);
    if (ns.length) {
      const sum = ns.reduce((a, b) => a + b, 0), mid = ns.length >> 1;
      const median = ns.length % 2 ? ns[mid] : (ns[mid - 1] + ns[mid]) / 2;
      h += `<div class="sect">${esc(t('type.number'))}</div>${kv('ui.min', num(ns[0]))}${kv('ui.max', num(ns[ns.length - 1]))}
        ${kv('ui.sum', num(sum))}${kv('ui.mean', num(sum / ns.length))}${kv('ui.median', num(median))}`;
    }
  } else if (col.type === 'date') {
    const ts = filled.map(toTime).filter(Number.isFinite);
    if (ts.length) {
      const f = ms => new Date(ms).toLocaleString(lang, {dateStyle: 'medium'});
      h += `<div class="sect">${esc(t('type.date'))}</div>${kv('ui.earliest', f(Math.min(...ts)))}${kv('ui.latest', f(Math.max(...ts)))}`;
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length && counts.size < filled.length) {
    const max = top[0][1];
    h += `<div class="sect">${esc(t('ui.top'))}</div><div class="bars">` + top.map(([k, n]) =>
      `<div class="bar"><span title="${esc(k)}">${esc(k)}</span><b>${num(n)}</b><i style="width:${Math.max(2, n / max * 100)}%"></i></div>`).join('') + '</div>';
  }
  h += `<p class="empty" style="padding:14px 0 0;text-align:left">${esc(t('ui.shownRows', {n: num(sh.view.length)}))}</p>`;
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
function chartData(sh, cfg) {
  const used = new Set([cfg.x, ...cfg.ys]);
  const rows = sh.view.map(i => sh.rows[i].map((_, c) => used.has(c) ? cellValue(sh, i, c) : null)), xcol = sh.cols[cfg.x];
  const ys = cfg.ys.filter(y => sh.cols[y]);
  const numOf = (r, y) => toNumber(r[y], sh.cols[y].numStyle);
  if (cfg.type === 'scatter') {
    const y = ys[0]; if (y == null) return null;
    const pts = [];
    for (const r of rows) { const xv = xcol.type === 'date' ? toTime(r[cfg.x]) : toNumber(r[cfg.x], xcol.numStyle), yv = numOf(r, y); if (Number.isFinite(xv) && Number.isFinite(yv)) pts.push({x: xv, y: yv}); if (pts.length >= 5000) break; }
    return {scatter: true, datasets: [{label: sh.cols[y].name, data: pts}]};
  }
  if (cfg.agg === 'count') {
    const m = new Map();
    for (const r of rows) { const k = rawText(r[cfg.x]); m.set(k, (m.get(k) || 0) + 1); }
    let entries = [...m.entries()];
    if (cfg.type !== 'line') entries.sort((a, b) => b[1] - a[1]);
    entries = entries.slice(0, cfg.limit);
    return {labels: entries.map(e => e[0]), datasets: [{label: t('agg.count'), data: entries.map(e => e[1])}]};
  }
  if (!ys.length) return null;
  if (cfg.agg === 'none') {
    const part = rows.slice(0, cfg.limit);
    return {labels: part.map(r => rawText(r[cfg.x])), datasets: ys.map(y => ({label: sh.cols[y].name, data: part.map(r => { const n = numOf(r, y); return Number.isFinite(n) ? n : null; })}))};
  }
  const groups = new Map();
  for (const r of rows) {
    const k = rawText(r[cfg.x]);
    let g = groups.get(k); if (!g) groups.set(k, g = ys.map(() => ({s: 0, n: 0})));
    ys.forEach((y, j) => { const n = numOf(r, y); if (Number.isFinite(n)) { g[j].s += n; g[j].n++; } });
  }
  let keys = [...groups.keys()];
  const val = (k, j) => { const g = groups.get(k)[j]; return cfg.agg === 'avg' ? (g.n ? g.s / g.n : null) : g.s; };
  if (xcol.type === 'number' || xcol.type === 'date') {
    const key = k => xcol.type === 'date' ? toTime(k) : toNumber(k, xcol.numStyle);
    keys.sort((a, b) => (key(a) || 0) - (key(b) || 0));
    keys = keys.slice(0, cfg.limit);
  } else if (keys.length > cfg.limit || cfg.type !== 'line') {
    keys.sort((a, b) => (val(b, 0) || 0) - (val(a, 0) || 0));
    keys = keys.slice(0, cfg.limit);
  }
  return {labels: keys, datasets: ys.map((y, j) => ({label: sh.cols[y].name, data: keys.map(k => val(k, j))}))};
}
function renderChart() {
  const sh = sheet();
  if (chart) { chart.destroy(); chart = null; }
  if (!sh || settings.view === 'table' || !window.Chart) return;
  const cfg = chartCfg(sh), data = chartData(sh, cfg);
  const empty = $('#chartEmpty');
  const xName = sh.cols[cfg.x] ? sh.cols[cfg.x].name : '';
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
    const aoa = [...(sh.header || !keepRaw ? [cols.map(c => c.name)] : []), ...idx.map(i => cols.map((_, c) => cell(i, c)))];
    const bom = fmt === 'csvSemi' || (keepRaw && d.bom);
    return (bom ? '﻿' : '') + Papa.unparse(aoa, {delimiter: delim, newline: '\r\n'});
  }
  if (fmt === 'json' || fmt === 'jsonl') {
    const objs = idx.map(i => Object.fromEntries(cols.map((c, ci) => {
      const v = typed(value(sh, i, ci), c);
      return [c.name, v instanceof Date ? isoDate(v) : v];
    })));
    return fmt === 'json' ? JSON.stringify(objs, null, 2) + '\n' : objs.map(o => JSON.stringify(o)).join('\n') + '\n';
  }
  if (fmt === 'md') {
    const cellMd = s => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    return [`| ${cols.map(c => cellMd(c.name)).join(' | ')} |`,
      `|${cols.map(c => c.type === 'number' ? '---:' : ':---').join('|')}|`,
      ...idx.map(i => `| ${cols.map((_, c) => cellMd(displayCell(sh, i, c))).join(' | ')} |`)].join('\n') + '\n';
  }
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
  fmtNoFill: () => applyFormat({bg: null}), fmtClear: () => applyFormat({clear: 1}),
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
    ['fmtFontColor'], ['fmtFill'], ['fmtNoFill'], ['fmtBorders'], '-', ['fmtAlignLeft'], ['fmtAlignCenter'], ['fmtAlignRight'], ['fmtWrap'], '-', ['fmtClear']]],
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
  const fb = $('#fmtBtns'); fb.innerHTML = '';
  const letter = (a, html) => { const b = makeBtn(a, html); b.classList.add('txt'); return b; };
  fb.append(letter('fmtBold', '<b>B</b>'), letter('fmtItalic', '<i style="font-family:Georgia,serif">I</i>'), letter('fmtUnderline', '<u>U</u>'),
    letter('fmtFontColor', '<span class="cbtn">A<i id="fcBar"></i></span>'), letter('fmtFill', `<span class="cbtn">${ICONS.fill}<i id="bgBar"></i></span>`),
    makeBtn('fmtAlignLeft', ICONS.alignL), makeBtn('fmtAlignCenter', ICONS.alignC), makeBtn('fmtAlignRight', ICONS.alignR), makeBtn('fmtWrap', ICONS.wrap), makeBtn('fmtBorders', ICONS.borders));
  const nf = document.createElement('select'); nf.id = 'nfSel'; nf.title = t('ui.numFormat');
  nf.innerHTML = NUM_FORMATS.map(c => `<option value="${esc(c)}">${esc(nfLabel(c))}</option>`).join('');
  nf.onchange = () => { if (nf.value) applyFormat({nf: nf.value === 'General' ? null : nf.value}); grid.focus(); };
  fb.append(nf, makeBtn('fmtClear', ICONS.eraser));
  fill('#viewBtns', [['toggleCompact', ICONS.rows], ['togglePanels', ICONS.panel], ['settings', ICONS.gear], ['shortcuts', ICONS.help]]);
  const tools = $('#tools'); tools.innerHTML = '';
  [['insertRow', ICONS.rowAdd], ['deleteRows', ICONS.rowDel], ['insertCol', ICONS.colAdd], ['deleteCol', ICONS.colDel], '-',
    ['sortAsc', ICONS.sortAsc], ['sortDesc', ICONS.sortDesc], ['toggleFilters', ICONS.filter], ['clearView', ICONS.clear], '-', ['viewSplit', ICONS.chart]]
    .forEach(r => { if (r === '-') { const s = document.createElement('div'); s.className = 'sep'; tools.append(s); } else tools.append(makeBtn(...r)); });
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
window.__dt = {openFiles, A, cur, sheet, serialize, parseFile, doOp, undoRedo, setSel, recompute, refresh, pasteText, settings: () => settings};
