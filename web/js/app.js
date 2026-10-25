(function () {
  "use strict";
  const C = window.BomCore, T = C.T;
  const $ = (id) => document.getElementById(id);
  const TYPE_CLASS = { [T.MISSING_SMT]: "t-miss", [T.MISSING_BOM]: "t-miss", [T.MPN_MISMATCH]: "t-mm", [T.DUP_BOM]: "t-dup", [T.DUP_SMT]: "t-dup" };
  const XL_FILL = { [T.MISSING_SMT]: "FFC7CE", [T.MISSING_BOM]: "FFDADA", [T.MPN_MISMATCH]: "FFF2CC", [T.DUP_BOM]: "FCE4D6", [T.DUP_SMT]: "FCE4D6" };

  const state = {
    smt: null,       // {name, lines:[{loc,text}]}
    bom: null,       // {name, wb}
    result: null,    // comparison result
    sample: false,
    sortKey: "ref", sortDir: 1,
    filterType: "", terms: [],
  };

  /* ---------------------------------------------------------- settings */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bomsmt." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("bomsmt." + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  $("prefixes").value = store.get("prefixes", C.DEFAULT_PREFIXES);
  $("ignore").value = store.get("ignore", "");
  $("learn").checked = store.get("learn", true);
  $("checkMpn").checked = store.get("checkMpn", true);
  $("excludeDnp").checked = store.get("excludeDnp", true);
  function saveSettings() {
    store.set("prefixes", $("prefixes").value); store.set("ignore", $("ignore").value);
    store.set("learn", $("learn").checked); store.set("checkMpn", $("checkMpn").checked); store.set("excludeDnp", $("excludeDnp").checked);
  }

  /* ------------------------------------------------------------ dialog */
  function showDialog(kind, title, message, details, actions) {
    const body = $("dlgBody");
    body.className = "dlg " + kind;
    $("dlgBadge").textContent = kind === "info" ? "✓" : "!";
    $("dlgTitle").textContent = title;
    $("dlgMsg").textContent = message;
    $("dlgDetails").hidden = !details;
    $("dlgDetails").open = false;
    $("dlgDetailText").textContent = details || "";
    const acts = $("dlgActs"); acts.innerHTML = "";
    return new Promise((resolve) => {
      (actions || [{ label: "OK", value: "ok", primary: true }]).forEach((a) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "btn" + (a.primary ? " primary" : ""); b.textContent = a.label;
        b.addEventListener("click", () => { $("dlg").close(); resolve(a.value); });
        acts.appendChild(b);
      });
      $("dlg").onclose = () => resolve(null);
      if (typeof $("dlg").showModal === "function") $("dlg").showModal(); else $("dlg").setAttribute("open", "");
      acts.lastChild && acts.lastChild.focus();
    });
  }
  const errorBox = (e) => showDialog("error", e.title || "Unexpected error",
    e instanceof C.AppError ? e.message : "An unexpected error occurred:\n" + (e && e.message ? e.message : e),
    e instanceof C.AppError ? "" : (e && e.stack) || "");

  /* ------------------------------------------------------------- files */
  const ext = (name) => (name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  const kb = (n) => n < 1024 * 1024 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";

  function wireDrop(dropId, inputId, handler) {
    const drop = $(dropId), input = $(inputId);
    input.addEventListener("change", () => { if (input.files[0]) handler(input.files[0]); input.value = ""; });
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
    drop.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handler(f); });
  }
  // Stop the browser opening a file dropped outside the drop zones
  ["dragover", "drop"].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));

  async function readSmtFile(file) {
    const x = ext(file.name);
    if (![".txt", ".log", ".pdf"].includes(x)) throw new C.AppError(`Unsupported setup sheet type "${x || file.name}". Use .txt, .log or .pdf.`, "Unsupported File");
    if (!file.size) throw new C.AppError("The SMT setup sheet is empty.", "Parsing Error");
    const buf = await file.arrayBuffer();
    if (x !== ".pdf") {
      return C.decodeText(new Uint8Array(buf)).split(/\r\n|\r|\n/).map((t, i) => ({ loc: `Line ${i + 1}`, text: t }));
    }
    if (!window.pdfjsLib) throw new C.AppError("The PDF reader failed to load. Reload the page and try again.", "File Read Error");
    let doc;
    try { doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise; }
    catch (e) {
      if (e && e.name === "PasswordException") throw new C.AppError("The PDF is password protected. Remove the password and try again.", "File Read Error");
      throw new C.AppError("The PDF could not be read. It may be corrupt or not a real PDF.\n\nDetails: " + (e.message || e), "File Read Error");
    }
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      C.pdfItemsToLines(tc.items).forEach((t, i) => lines.push({ loc: `Page ${p}, line ${i + 1}`, text: t }));
    }
    if (!lines.some((l) => l.text.trim()))
      throw new C.AppError("The PDF contains no extractable text. It is probably a scanned image.\n\nRun it through OCR (\"Save as searchable PDF\") or export the setup sheet as text from the SMT software.", "Parsing Error");
    return lines;
  }

  // The first real file replaces the built-in sample on both sides
  function leaveSample() {
    if (!state.sample) return;
    state.sample = false; state.smt = null; state.bom = null; state.result = null;
    $("sampleBanner").hidden = true;
    $("smtName").textContent = "Click or drop a .txt, .log or .pdf"; $("smtDrop").classList.remove("loaded");
    $("bomName").textContent = "Click or drop a .xlsx or .xls"; $("bomDrop").classList.remove("loaded");
    $("sheetSel").innerHTML = ""; ["refCol", "mpnCol", "descCol"].forEach((id) => { $(id).value = ""; });
    ["sBom", "sSmt", "sCommon", "sVer", "sDnp", "sTotal"].forEach((id) => { $(id).textContent = "–"; });
    $("chips").innerHTML = ""; $("tbody").innerHTML = ""; $("count").textContent = ""; $("srcInfo").textContent = "";
    $("exportBtn").disabled = true;
    const empty = $("empty"); empty.hidden = false; empty.className = "empty";
    empty.innerHTML = "<strong>Ready for your files</strong>Choose both files, check the columns, then press Compare files.";
  }

  async function onSmt(file) {
    leaveSample();
    try {
      setMsg("Reading setup sheet…");
      const lines = await readSmtFile(file);
      state.smt = { name: file.name, lines };
      $("smtName").textContent = `${file.name} · ${kb(file.size)} · ${lines.length} lines`;
      $("smtIco").textContent = ext(file.name).slice(1).toUpperCase();
      $("smtDrop").classList.add("loaded");
      setMsg("");
    } catch (e) { setMsg(""); errorBox(e); }
  }

  async function onBom(file) {
    leaveSample();
    try {
      const x = ext(file.name);
      if (![".xlsx", ".xls", ".xlsm"].includes(x)) throw new C.AppError(`Unsupported BOM type "${x || file.name}". Use .xlsx or .xls.`, "Unsupported File");
      setMsg("Reading BOM workbook…");
      const buf = await file.arrayBuffer();
      let wb;
      try { wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true }); }
      catch (e) {
        const pw = /password|encrypt/i.test(e.message || "");
        throw new C.AppError(pw ? "The workbook is password protected. Save an unprotected copy and try again."
          : "Unable to open the BOM workbook. It may be corrupt or not an Excel file.\n\nDetails: " + (e.message || e), "File Read Error");
      }
      if (!wb.SheetNames.length) throw new C.AppError("The workbook has no sheets.", "File Read Error");
      state.bom = { name: file.name, wb };
      $("bomName").textContent = `${file.name} · ${kb(file.size)} · ${wb.SheetNames.length} sheet(s)`;
      $("bomIco").textContent = x.slice(1).toUpperCase();
      $("bomDrop").classList.add("loaded");
      const sel = $("sheetSel"); sel.innerHTML = "";
      wb.SheetNames.forEach((n) => sel.add(new Option(n, n)));
      const bomSheet = wb.SheetNames.find((n) => /bom/i.test(n));
      if (bomSheet) sel.value = bomSheet;
      $("headerRow").value = 0;
      loadHeaders(true);
      setMsg("");
    } catch (e) { setMsg(""); errorBox(e); }
  }

  function sheetRows(wb, name) {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) return [];
    const range = XLSX.utils.decode_range(ws["!ref"]);
    range.s.r = 0; range.s.c = 0;   // keep real Excel row numbers
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true, raw: true, range });
  }

  function loadHeaders(guess) {
    if (!state.bom) return;
    try {
      const raw = sheetRows(state.bom.wb, $("sheetSel").value);
      const { headers, idx } = C.peekHeaders(raw, parseInt($("headerRow").value, 10) || 0);
      const fill = (id, list) => { const dl = $(id); dl.innerHTML = ""; list.forEach((h) => dl.appendChild(new Option(h))); };
      fill("colList", headers); fill("colListDesc", [C.NONE_OPTION, ...headers]);
      if (guess) {
        $("refCol").value = C.guessColumn(headers, "ref") || "";
        $("mpnCol").value = C.guessColumn(headers, "mpn") || "";
        $("descCol").value = C.guessColumn(headers, "desc") || "";
      }
      const auto = (parseInt($("headerRow").value, 10) || 0) === 0;
      setMsg(`Headers read from row ${idx + 1}${auto ? " (detected)" : ""}: ${headers.length} columns.`);
    } catch (e) { errorBox(e); }
  }

  wireDrop("smtDrop", "smtFile", onSmt);
  wireDrop("bomDrop", "bomFile", onBom);
  $("sheetSel").addEventListener("change", () => { $("headerRow").value = 0; loadHeaders(true); });
  $("headerRow").addEventListener("change", () => loadHeaders(true));

  /* ----------------------------------------------------------- compare */
  const setMsg = (m) => { $("progMsg").textContent = m; };
  const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  async function progress(pct, msg) { $("prog").hidden = false; $("progBar").style.width = pct + "%"; setMsg(msg); await tick(); }

  function collectOptions() {
    if (!state.smt) throw new C.AppError("Please choose an SMT setup sheet.", "Missing File");
    if (!state.bom) throw new C.AppError("Please choose a BOM Excel file.", "Missing File");
    if (!$("refCol").value.trim()) throw new C.AppError("Please specify the Reference Designator column.", "Missing Column");
    if (!$("mpnCol").value.trim()) throw new C.AppError("Please specify the Manufacturer Part Number (MPN) column.", "Missing Column");
    const prefixes = C.parsePrefixList($("prefixes").value);
    if (!prefixes.length && !$("learn").checked) throw new C.AppError("Enter at least one designator prefix (e.g. R, C, U).", "Missing Prefixes");
    const hr = parseInt($("headerRow").value, 10);
    if (isNaN(hr) || hr < 0) throw new C.AppError("Header row must be 0 (auto-detect) or a positive row number.", "Invalid Header Row");
    return {
      headerRow: hr, refCol: $("refCol").value, mpnCol: $("mpnCol").value, descCol: $("descCol").value,
      prefixes, ignorePrefixes: new Set(C.parsePrefixList($("ignore").value)),
      learnPrefixes: $("learn").checked, checkMpn: $("checkMpn").checked, excludeDnp: $("excludeDnp").checked,
    };
  }

  async function compare(silent) {
    const btn = $("goBtn");
    let opts;
    try { opts = collectOptions(); } catch (e) { errorBox(e); return; }
    saveSettings();
    btn.disabled = true; btn.textContent = "Comparing…";
    try {
      await progress(10, "Reading BOM sheet…");
      const raw = sheetRows(state.bom.wb, $("sheetSel").value);
      await progress(45, "Scanning setup sheet for designators…");
      await progress(75, "Comparing…");
      const res = C.runComparison(raw, state.smt.lines, opts);
      await progress(100, "Done");
      state.result = res;
      $("sampleBanner").hidden = !state.sample;
      render();
      setMsg(`Done: ${res.stats.total} discrepancies (BOM header row ${res.headerRow}).`);
      if (!silent) {
        if (res.warnings.length)
          await showDialog("warn", "Finished with warnings", "The comparison finished, but some BOM data could not be read as designators. Open the details to review.", res.warnings.join("\n\n"));
        else if (res.stats.total === 0)
          await showDialog("info", "No discrepancies", "The BOM and the SMT setup sheet match.");
      }
    } catch (e) {
      setMsg("Comparison failed.");
      errorBox(e);
    } finally {
      btn.disabled = false; btn.textContent = "Compare files";
      setTimeout(() => { $("prog").hidden = true; }, 600);
    }
  }
  $("goBtn").addEventListener("click", () => { state.sample = false; compare(false); });

  /* ------------------------------------------------------------ render */
  const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function visibleRows() {
    if (!state.result) return [];
    let rows = state.result.rows.filter((r) => {
      if (state.filterType && r.type !== state.filterType) return false;
      if (!state.terms.length) return true;
      const hay = [r.ref, r.type, r.bomMpn, r.smtMpn, r.notes, r.desc, r.src].join(" ").toLowerCase();
      return state.terms.some((t) => hay.includes(t));
    });
    const k = state.sortKey, d = state.sortDir;
    rows = rows.slice().sort((a, b) => {
      const c = k === "ref" ? C.naturalCompare(a.ref, b.ref) : String(a[k]).localeCompare(String(b[k]), undefined, { numeric: true });
      return c ? c * d : C.naturalCompare(a.ref, b.ref);
    });
    return rows;
  }

  function render() {
    const res = state.result;
    const st = res.stats;
    $("sBom").textContent = st.bomRefs; $("sSmt").textContent = st.smtRefs; $("sCommon").textContent = st.common;
    $("sVer").textContent = st.mpnVerified; $("sDnp").textContent = st.dnpExcluded; $("sTotal").textContent = st.total;
    $("sTotal").parentElement.classList.toggle("bad", st.total > 0);
    $("sTotal").parentElement.classList.toggle("good", st.total === 0);

    const chips = $("chips"); chips.innerHTML = "";
    C.ALL_TYPES.filter((t) => st[t]).forEach((t) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip " + TYPE_CLASS[t];
      b.setAttribute("aria-pressed", String(state.filterType === t));
      b.innerHTML = `<span class="dot"></span>${escHtml(t)} <span class="c">${st[t]}</span>`;
      b.addEventListener("click", () => { state.filterType = state.filterType === t ? "" : t; $("typeSel").value = state.filterType; render(); });
      chips.appendChild(b);
    });

    const rows = visibleRows();
    const tb = $("tbody");
    tb.innerHTML = rows.map((r) => {
      const extra = [r.desc && `BOM: ${r.desc}`, r.src && `Setup: ${r.src}`].filter(Boolean).join(" · ");
      return `<tr class="${TYPE_CLASS[r.type]}">
        <td class="ref">${escHtml(r.ref)}</td>
        <td class="type">${escHtml(r.type)}</td>
        <td class="mpn">${escHtml(r.bomMpn)}</td>
        <td class="mpn">${escHtml(r.smtMpn)}</td>
        <td class="notes">${escHtml(r.notes)}${extra ? `<small>${escHtml(extra)}</small>` : ""}</td></tr>`;
    }).join("");

    const empty = $("empty");
    if (st.total === 0) { empty.hidden = false; empty.className = "empty ok"; empty.innerHTML = "<strong>✓ No discrepancies</strong>The BOM and the SMT setup sheet match."; }
    else if (!rows.length) { empty.hidden = false; empty.className = "empty"; empty.innerHTML = "<strong>No matching rows</strong>Clear the search or type filter to see all discrepancies."; }
    else empty.hidden = true;

    document.querySelectorAll("#tbl th").forEach((th) => {
      th.setAttribute("aria-sort", th.dataset.k === state.sortKey ? (state.sortDir > 0 ? "ascending" : "descending") : "none");
    });
    $("count").textContent = st.total ? `Showing ${rows.length} of ${st.total} rows` : "";
    $("srcInfo").textContent = `${state.bom ? state.bom.name : ""} ⇄ ${state.smt ? state.smt.name : ""}`;
    $("exportBtn").disabled = st.total === 0;
  }

  C.ALL_TYPES.forEach((t) => $("typeSel").add(new Option(t, t)));
  $("typeSel").addEventListener("change", () => { state.filterType = $("typeSel").value; if (state.result) render(); });
  $("search").addEventListener("input", () => {
    state.terms = $("search").value.toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (state.result) render();
  });
  document.querySelectorAll("#tbl th").forEach((th) => th.addEventListener("click", () => {
    if (state.sortKey === th.dataset.k) state.sortDir *= -1; else { state.sortKey = th.dataset.k; state.sortDir = 1; }
    if (state.result) render();
  }));

  /* ------------------------------------------------------------ export */
  async function exportExcel() {
    if (!state.result || !state.result.rows.length) return;
    let rows = visibleRows(), scope = "all";
    if (rows.length !== state.result.rows.length) {
      const choice = await showDialog("warn", "Export scope",
        `A filter is active: ${rows.length} of ${state.result.rows.length} rows are shown.\n\nExport only the visible rows, or all rows?`, "",
        [{ label: "Cancel", value: null }, { label: "All rows", value: "all" }, { label: "Visible rows", value: "visible", primary: true }]);
      if (!choice) return;
      if (choice === "all") rows = state.result.rows.slice().sort((a, b) => C.naturalCompare(a.ref, b.ref)); else scope = "filtered";
    }
    try {
      const st = state.result.stats;
      const wb = new ExcelJS.Workbook();
      wb.creator = "BOM SMT Comparator"; wb.created = new Date();
      const thin = { style: "thin", color: { argb: "FFBFBFBF" } };
      const border = { top: thin, left: thin, bottom: thin, right: thin };
      const head = (ws) => {
        ws.getRow(1).eachCell((c) => {
          c.font = { bold: true, color: { argb: "FFFFFFFF" } };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
          c.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; c.border = border;
        });
        ws.views = [{ state: "frozen", ySplit: 1 }];
      };

      const sum = wb.addWorksheet("Summary");
      sum.columns = [{ header: "Item", key: "k", width: 52 }, { header: "Value", key: "v", width: 70 }];
      const now = new Date();
      [["Report generated", now.toLocaleString()], ["BOM file", state.bom ? state.bom.name : ""], ["SMT setup sheet", state.smt ? state.smt.name : ""],
        ["Rows exported", `${rows.length} (${scope})`], ["", ""],
        ["Designators in BOM", st.bomRefs], ["Designators on SMT sheet", st.smtRefs], ["Designators in both", st.common],
        ["MPN verified", st.mpnVerified], ["MPN not verifiable (no part number on setup line)", st.mpnUnverified],
        ["DNP designators excluded from BOM", st.dnpExcluded], ["", ""],
        ...C.ALL_TYPES.map((t) => [t, st[t]]), ["Total discrepancies", st.total],
      ].forEach(([k, v]) => sum.addRow({ k, v }));
      head(sum);
      sum.eachRow((row, i) => { if (i > 1) row.eachCell({ includeEmpty: true }, (c) => { c.border = border; c.alignment = { vertical: "top", horizontal: "left", wrapText: true }; }); });

      const ws = wb.addWorksheet("Discrepancies");
      ws.columns = [
        { header: "Reference Designator", key: "ref", width: 20 }, { header: "Discrepancy Type", key: "type", width: 18 },
        { header: "BOM MPN", key: "bomMpn", width: 28 }, { header: "SMT MPN", key: "smtMpn", width: 28 },
        { header: "Notes", key: "notes", width: 70 }, { header: "BOM Description", key: "desc", width: 34 },
        { header: "SMT Source", key: "src", width: 22 },
      ];
      rows.forEach((r) => {
        const row = ws.addRow(r);
        const fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + (XL_FILL[r.type] || "FFFFFF") } };
        row.eachCell({ includeEmpty: true }, (c) => { c.fill = fill; c.border = border; c.alignment = { vertical: "top", wrapText: true }; });
      });
      head(ws);
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + rows.length, column: 7 } };

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const p = (n) => String(n).padStart(2, "0");
      const fname = `BOM_SMT_Discrepancies_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}.xlsx`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setMsg(`Report saved to your Downloads folder as ${fname}`);
    } catch (e) { errorBox(new C.AppError("Could not create the Excel report.\n\nDetails: " + (e.message || e), "Export Failed")); }
  }
  $("exportBtn").addEventListener("click", exportExcel);

  /* ------------------------------------------------------ sample data */
  function loadSample() {
    const S = window.BOM_SMT_SAMPLE;
    if (!S) return;
    const ws = XLSX.utils.aoa_to_sheet(S.bomRows);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "BOM");
    state.bom = { name: "Sample_BOM.xlsx", wb };
    state.smt = { name: "Sample_Setup.txt", lines: S.setupText.split(/\r\n|\r|\n/).map((t, i) => ({ loc: `Line ${i + 1}`, text: t })) };
    $("sheetSel").innerHTML = ""; $("sheetSel").add(new Option("BOM", "BOM"));
    $("bomName").textContent = "Sample_BOM.xlsx · built-in example";
    $("smtName").textContent = "Sample_Setup.txt · built-in example";
    $("headerRow").value = 0;
    loadHeaders(true);
    state.sample = true;
    compare(true);
  }

  if (!window.XLSX || !window.ExcelJS) {
    showDialog("error", "Libraries failed to load", "The spreadsheet components did not load. Re-download the file and open it again in Chrome or Edge.");
  } else {
    loadSample();
  }
})();
