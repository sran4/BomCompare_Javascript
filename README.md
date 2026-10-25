# BOM SMT Comparator

Browser tool that checks an SMT setup sheet against an engineering BOM. Files stay on your PC; nothing is uploaded to a server.

There are two copies of the same app:

| Path | What it is |
| --- | --- |
| `BOM_SMT_Comparator.html` | Single file. Double-click to open in Chrome or Edge. |
| `web/` | Same app split into HTML, CSS, and JS. Run with a local web server. |

## What you need

- Chrome or Edge
- For the `web/` version: [Python 3](https://www.python.org/downloads/) (used only to serve the files)

Supported inputs:

- **SMT setup sheet:** `.txt`, `.log`, or a text-based `.pdf` (not a scanned image)
- **BOM:** `.xlsx`, `.xls`, or `.xlsm`

## Option A — single HTML file (easiest)

1. Download or clone this repo.
2. Double-click `BOM_SMT_Comparator.html`.
3. It opens in your browser with a built-in sample comparison.

To pin it to the Windows desktop: right-click `BOM_SMT_Comparator.html` → **Show more options** → **Send to** → **Desktop (create shortcut)**.

## Option B — split `web/` app

From PowerShell:

```powershell
cd path\to\BomCompare_Javascript\web
python -m http.server 8765
```

Then open [http://127.0.0.1:8765/](http://127.0.0.1:8765/) in Chrome or Edge.

Leave the Command Prompt window open while you use the tool. Close it when you are done.

Do not double-click `web/index.html`. Opening it as a file can stop PDF setup sheets from loading.

### Windows desktop shortcut for `web/`

Create `BOM SMT Comparator.bat` on your Desktop with:

```bat
@echo off
cd /d "C:\path\to\BomCompare_Javascript\web"
start "" http://127.0.0.1:8765/
python -m http.server 8765
```

Change the `cd` path to your clone location. Double-click the `.bat` to start the server and open the browser.

## How to compare files

1. Wait for the sample comparison to load, or skip it by dropping your own files.
2. Drop or click to choose the **SMT setup sheet** (left, first drop zone).
3. Drop or click to choose the **BOM Excel** file.
4. Check **Sheet**, **Header row**, **Ref. designators**, and **MPN**. Header row `0` means auto-detect.
5. Adjust prefixes if your designators are not the usual `R`, `C`, `U`, and so on.
6. Click **Compare files**.
7. Filter or search the discrepancy table. Click **Export to Excel** to save a report.

Discrepancy types:

- **Missing in SMT** — in the BOM, not on the setup sheet
- **Missing in BOM** — on the setup sheet, not in the BOM (including DNP parts that were loaded)
- **MPN Mismatch** — same designator, different part number
- **Duplicate in BOM** / **Duplicate in SMT** — the same designator listed more than once

## Notes

- Password-protected workbooks and PDFs are not supported. Save an unprotected copy first.
- Image-only PDFs need OCR first, or export the setup sheet as text from the SMT software.
- The app runs fully in the browser. Your BOM and setup files never leave the machine.
