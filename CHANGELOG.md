# Changelog

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