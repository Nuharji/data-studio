# Data Studio

CSV / TSV / JSON / Excel viewer and editor of the Studio family (Rust / Tauri 2): filter, sort, statistics, charts, edit, convert.

- UI: `ui/` (SheetJS, Papa Parse, Chart.js)
- Native backend: `src-tauri/src/main.rs`; Excel files with formatting: `src-tauri/src/xlsx.rs` (umya-spreadsheet), display of formats: `ui/xformat.js`.

## Build (Windows x64)

```powershell
.\build-windows.ps1          # installers + portable exe in .\dist
```
