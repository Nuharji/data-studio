# Changelog

## 1.13.1 — 2026-10-15
- App icon with a picture of what the app does, like Slides and Plan Studio; the window and taskbar icon is now the same picture.

## 1.13.0 — 2026-10-15
- New: Function plots (Chart → Function plot): up to 6 terms like `x^2 - 2x - 3`, `sin(x)`, `2,5·e^(-x)`, `|x|`, with implicit multiplication and decimal comma; zeros, turning points (maxima / minima) and the y-intercept are listed for each graph. Poles (1/x, tan) are drawn as gaps. Calculated in Rust (plot.rs).
- New: Trend line for point charts — linear regression with its equation and R².
- New: Pivot tables (Pivot panel): rows × columns of one or two columns, summarizing a number column (sum, average, minimum, maximum, count) or counting rows, with totals; “Open as new table” turns the result into a table to save or chart. Search and filters apply.
- Column statistics: standard deviation, variance, quartiles and range.
- Shared with all Studio apps (shared.rs / shared.js): theme and language follow the other apps and Studio Hub (also when you switch windows), and file dialogs open in the work folder chosen in Studio Hub.

## 1.12.2 — 2026-10-11
- Fixed: CSV files in Windows-1252 (e.g. saved by German Excel as “CSV (Trennzeichen-getrennt)”) were saved back as UTF-8 without BOM, so Excel then showed “MÃ¼ller” instead of “Müller”. CSV and TSV files now keep their encoding (Windows-1252, UTF-16 or UTF-8). If a character doesn’t fit Windows-1252, the file is saved as UTF-8 with BOM, which Excel also reads correctly, and you get a note.

## 1.12.1 — 2026-10-11
- Fixed: saving a CSV or TSV file changed its line endings to Windows style (CRLF), so in Git every line showed as changed. Files keep their own line endings now (LF stays LF); exports to a new file still use CRLF.

## 1.12.0 — 2026-10-11
- Zoom for the table (50–200 %): text, row heights and column widths grow and shrink together. Ctrl + mouse wheel, Ctrl++ / Ctrl+0, View → Zoom In / Zoom Out / Actual Size, − 100 % + in the status bar, and a slider in Settings → Table. The zoom is remembered; column widths saved to Excel files are not changed by it.

## 1.11.0 — 2026-10-11
- Loading information while a file opens: a card with the file name, the current step (reading the file, reading the data, preparing the table) and a real progress bar — megabytes read and, for CSV/TSV, megabytes parsed. It only appears when opening takes a moment.
- Faster opening of large files: the file is now read and parsed in one go by the Rust core instead of being sent to the window and back (a 92 MB CSV: 11 s instead of 13 s).

## 1.10.0 — 2026-10-11
- New: Settings → Shortcuts. Every menu command can get its own key: click it and press the new combination (with Ctrl or Alt, or a function key); Backspace removes a shortcut, ↺ or “Reset all” brings the defaults back. A key that another command used is moved (you get a note); system keys like Copy stay fixed. Menus, tooltips and Help → Keyboard Shortcuts show your keys.

## 1.9.0 — 2026-10-11
- New: Auto-hide bars (View menu, or Settings → General). The menu bar, toolbar, tool rail and status bar leave the window and slide in when the mouse touches their edge; they stay while a menu is open or you type in them. Alt alone shows the top bars (Escape or a click elsewhere hides them).

## 1.8.0 — 2026-10-11
- Spelling & grammar check for text cells, German and English, entirely on your PC: misspelled words get a red wavy underline in the cell, grammar hints a blue one. Numbers, dates and formulas are skipped.
- Right-click an underlined word for suggestions, “Add to dictionary” (a personal dictionary shared by all Studio apps) or “Ignore”. F7 or the status bar jumps to the next cell with an issue.
- Settings → Table → Spelling & grammar: Automatic (German + English), German, English or Off.
- The portable .zip now includes the dictionaries (separate files with their own licenses, see dictionaries/README.md); the bare portable .exe has no spell check.

## 1.7.0 — 2026-10-11
- Formula syntax guide: while typing a formula (in a cell or the formula bar), matching functions are suggested (↑↓, Tab to insert) and the syntax of the current function is shown with the current argument highlighted — in English or German.
- Pick cells for formulas: where a reference fits (after =, an operator, a bracket or a separator), click a cell to insert it (e.g. B1) or drag over cells for a range (B1:B3); clicking again replaces it. References in the formula are outlined in color.
- New: Help → Formula Functions (Shift+F3, or click fx in the formula bar): all functions with syntax, description and example, searchable.

## 1.6.2 — 2026-10-11
- Column statistics (values, empty, unique, minimum/maximum/sum/mean/median, earliest/latest date, most frequent values) and chart data (grouping, sum/average/count, order, limit) are now worked out by the Rust core; the UI only draws them.

## 1.6.1 — 2026-10-11
- The English and German texts are now language files (src-tauri/i18n) delivered by the app's Rust core instead of being part of the JavaScript.

## 1.6.0 — 2026-10-10
- Column types, search, column filters and sorting are now computed by the app's Rust core — much faster with big tables (100,000 rows: sorting ~0.25 s, filtering ~0.1 s).
- Same rules as before: numbers in English or German style, dates, yes/no columns; filters like >5, 10..20, =exact, !not; natural sort order (Datei2 before Datei10), empty cells last.

## 1.5.0 — 2026-10-10
- Formulas are now calculated by the app's Rust core: same functions (English and German names), German decimal commas, Excel errors and circular-reference detection as before — the table keeps a copy in Rust that every edit updates.
- The JavaScript formula calculator is removed; only the tools that adjust references when rows or columns move remain there.

## 1.4.0 — 2026-10-10
- CSV, TSV, JSON, JSON Lines and old spreadsheets (.xls, .ods) are now read by the app's Rust core, and CSV / JSON / Markdown files are written there — faster with big files, less JavaScript.
- Text files: UTF-8, UTF-16 and Windows-1252 (old Excel exports) are recognised; the separator (comma, semicolon, tab, pipe) is detected from the first lines.
- .ods files keep their formulas (OpenDocument formulas are translated to Excel style), and .ods files saved by Data Studio itself open again reliably.
## 1.3.1 — 2026-10-10
- The formatting tools (bold, colors, alignment, borders, number format …) are now in the tool rail on the left, like in Markdown Studio. Number formats open as a menu with an example for each format.

## 1.3.0 — 2026-10-10
- Excel formatting: bold, italic, underline, strikethrough, text and fill colors, alignment, wrapped text, borders, fonts and sizes are shown in the table and kept when saving.
- Number formats like in Excel: thousands separators, decimals, percent, currency (€, $), dates and times, scientific — shown in your language (1.234,50 € in German).
- Merged cells, column widths and row heights are kept; merged cells are shown while the table isn't sorted or filtered.
- Saving an Excel file keeps what Data Studio doesn't edit: dropdown lists, conditional formatting, frozen panes, print settings, images.
- New Format menu and toolbar (Ctrl+B / Ctrl+I / Ctrl+U, colors, alignment, wrap, borders, number format, clear formatting) — every change can be undone.
- Excel files are now read and written by the app's Rust core (faster, and more of the file is preserved).
## 1.2.5 — 2026-10-10
- Icon fades swapped: dark themes now show the dark fade and light themes the light fade — in the menu bar, on the start screen and in the taskbar.

## 1.2.4 — 2026-10-10
- The app icon follows the theme: a light fade in dark themes, a dark fade in light themes — in the menu bar, on the start screen and in the window/taskbar icon.
- All Studio icons now have exactly the same rounded corners.

## 1.2.3 — 2026-10-10
- "New table" now offers three formats: Excel workbook, CSV or JSON.

## 1.2.2 — 2026-10-10
- Switching the header row on or off no longer breaks formulas: references move with their rows (like inserting or deleting a row in Excel).
- Tables without a header row are saved to Excel without an extra row of placeholder column names, so formulas point at the right cells.

## 1.2.1 — 2026-10-10
- New app icon with a dark-to-bright green fade, matching the Studio family look (also in the title bar and start screen).

## 1.2.0 — 2026-10-10
- Formulas like in Excel: `=SUM(A1:B5)`, `=A1*B1`, `=IF(...)` and about 30 functions, with English or German names (`=SUMME(A1;B1)`).
- Formula bar above the table shows the address and formula of the selected cell.
- Formulas follow when rows or columns are inserted or deleted; errors show as `#DIV/0!`, `#REF!`, `#NAME?` like in Excel.
- Excel files keep their formulas when opened and saved; exports write the calculated values.
- "New table" asks whether you want an Excel workbook or a CSV file.

## 1.1.1 — 2026-10-10
- The Windows taskbar and Alt+Tab now show the open file's name.

## 1.1.0 — 2026-10-10
- Right-click opens native Windows menus for cells, column headers, row numbers, the chart and tabs.
- Cut, copy and paste through the system clipboard; "Show only this value" filter from the menu.

## 1.0.0 — 2026-10-10
- First release: open CSV, TSV, JSON, JSON Lines and Excel (.xlsx, .xls, .ods).
- Fast table for 100,000+ rows, search, column filters, sorting, editing with undo, copy/paste with Excel.
- Column statistics, charts (bar, line, pie, scatter), export to CSV, CSV for German Excel, TSV, JSON, Excel and Markdown.