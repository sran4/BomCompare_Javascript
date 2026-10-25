"""Sync BOM_SMT_Comparator.html from web/ html, css, core.js, app.js. Vendor scripts stay as-is."""
from pathlib import Path
import re

root = Path(__file__).resolve().parent
html_path = root / "BOM_SMT_Comparator.html"
html = html_path.read_text(encoding="utf-8")
css = (root / "web" / "css" / "styles.css").read_text(encoding="utf-8")
index = (root / "web" / "index.html").read_text(encoding="utf-8")
core = (root / "web" / "js" / "core.js").read_text(encoding="utf-8")
app = (root / "web" / "js" / "app.js").read_text(encoding="utf-8")

body = re.search(r'<div class="wrap">.*?</dialog>', index, re.S)
if not body:
    raise SystemExit("Could not find wrap/dialog in index.html")

html, n1 = re.subn(r"<style>.*?</style>", lambda _m: "<style>\n" + css + "\n</style>", html, count=1, flags=re.S)
html, n2 = re.subn(r'<div class="wrap">.*?</dialog>', lambda _m: body.group(0), html, count=1, flags=re.S)

core_start = html.find("<script>/* ==========================================================================")
core_end = html.find("</script>", core_start)
if core_start < 0 or core_end < 0:
    raise SystemExit("Could not find BomCore script")
html = html[:core_start] + "<script>" + core + "</script>" + html[core_end + len("</script>"):]
n3 = 1

app_mark = '<script>\n(function () {\n  "use strict";\n  const C = window.BomCore'
app_start = html.rfind(app_mark)
if app_start < 0:
    app_mark = '<script>\r\n(function () {\r\n  "use strict";\r\n  const C = window.BomCore'
    app_start = html.rfind(app_mark)
if app_start < 0:
    raise SystemExit("Could not find app script")
body_end = html.rfind("</body>")
html = html[:app_start] + "<script>\n" + app + "\n</script>\n" + html[body_end:]
n4 = 1

print("style", n1, "body", n2, "core", n3, "app", n4)

# ExcelJS must load before SheetJS so it does not treat `exports` as CommonJS.
xlsx_open = html.find("<script>/*! xlsx.js")
excel_open = html.find("<script>/*! ExcelJS")
if xlsx_open >= 0 and excel_open >= 0 and xlsx_open < excel_open:
    def block(start):
        end = html.find("</script>", start)
        return html[start:end + len("</script>")]
    xlsx_b, excel_b = block(xlsx_open), block(excel_open)
    html = html.replace(xlsx_b, "__XLSX_BLOCK__", 1).replace(excel_b, xlsx_b, 1).replace("__XLSX_BLOCK__", excel_b, 1)
    print("swapped xlsx/exceljs order")

html_path.write_text(html, encoding="utf-8")
print("wrote", html_path, "bytes", html_path.stat().st_size)
