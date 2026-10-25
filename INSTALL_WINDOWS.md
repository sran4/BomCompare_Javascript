# Install on Windows (JavaScript app)

There is nothing to install with pip or Python. After you download the ZIP, you only need Chrome or Edge.

## 1. Unpack the app

1. Download the ZIP from GitHub (green **Code** → **Download ZIP**).
2. Right-click the ZIP → **Extract All…**
3. Open the folder that contains `BOM_SMT_Comparator.html` and `Open.bat`.

## 2. Run it

**Easiest:** double-click `Open.bat`, **or** double-click `BOM_SMT_Comparator.html`.

It should open in Chrome or Edge. A built-in sample comparison loads first.

If Windows SmartScreen blocks the `.bat`: **More info** → **Run anyway**.

If it opens in Notepad instead of a browser:

1. Right-click `BOM_SMT_Comparator.html` → **Open with** → **Microsoft Edge** or **Google Chrome**.
2. Optionally check **Always**.

The split copy is the same app: open `web\index.html` the same way.

## 3. Optional desktop shortcut

1. Right-click `BOM_SMT_Comparator.html` → **Show more options** → **Send to** → **Desktop (create shortcut)**.
2. Or right-click `Open.bat` and send that to the desktop.

## After it opens

1. Wait for the sample, or drop your own files on the left.
2. SMT setup: `.txt`, `.log`, or a text PDF (not a scanned image).
3. BOM: `.xlsx`, `.xls`, or `.xlsm`.
4. Click **Compare files**.

Your files stay on this PC. Nothing is uploaded.

## If it fails

- **Libraries failed to load** → close the tab and open the HTML again in Chrome or Edge (not Internet Explorer).
- Blank page → use Edge or Chrome, not a preview inside email or Explorer’s tiny preview pane.
- Password-protected Excel/PDF files are not supported. Scanned PDFs need OCR first.
