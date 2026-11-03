# Data Studio

CSV / TSV / JSON / Excel viewer and editor of the Studio family (Rust / Tauri 2): filter, sort, statistics, charts, edit, convert.

- UI: `ui/` (SheetJS, Papa Parse, Chart.js)
- Native backend: `src-tauri/src/main.rs`; CSV/TSV/JSON/.xls/.ods reading and CSV/JSON/MD writing: `src-tauri/src/table.rs`; Excel files with formatting: `src-tauri/src/xlsx.rs` (umya-spreadsheet), display of formats: `ui/xformat.js`.

## MCP
Data Studio is also an MCP server, so Claude (Desktop or Code), ChatGPT and other MCP clients can use what it can do:
started with `--mcp`, the program opens no window and speaks MCP on stdin / stdout until the client closes it.

- `table_info` — The sheets of a data file with their numbers of rows and columns, and the first row.
- `table_read` — Reads rows of a table. Formula cells show their result, or the formula itself with formulas: true.
- `column_stats` — Statistics of a column (0 is the first): count, empty, unique, sum, average, quantiles, most frequent values.
- `write_csv` — Writes rows to a new .csv or .tsv file. Replaces an existing file only with overwrite.

Only .csv / .tsv files are written, an existing one only with `overwrite`. Files are given as full paths.

Claude Code: `claude mcp add data-studio -- "/Applications/Data Studio.app/Contents/MacOS/data-studio" --mcp`.
Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "data-studio": {
      "command": "/Applications/Data Studio.app/Contents/MacOS/data-studio",
      "args": [
        "--mcp"
      ]
    }
  }
}
```
The program is `/Applications/Data Studio.app/Contents/MacOS/data-studio` on macOS, `data-studio.exe` in the install folder on
Windows, and `data-studio` (or the AppImage) on Linux.

## Build (Windows x64)

```powershell
.\build-windows.ps1          # installers + portable exe in .\dist
```
