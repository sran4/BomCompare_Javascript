/* ==========================================================================
   BOM ⇄ SMT comparison core (pure functions, no DOM).
   Mirrors the rules of bom_smt_comparator.py.
   ========================================================================== */
(function (root) {
  "use strict";

  const DEFAULT_PREFIXES = "R, C, L, U, D, Q, J, P, Y, X, F, FB, FL, K, T, TP, SW, LED, BT, CN, CR, VR, RN, RP, IC, JP, ZD";
  const NONE_OPTION = "(none)";
  const PACKAGE_CODES = new Set(["0100","0201","0402","0603","0805","1008","1206","1210","1806","1812","2010","2220","2512"]);
  const MAX_RANGE_EXPANSION = 1000;

  const GENERIC_REF_RE = /^([A-Z]{1,5})(\d{1,6})([A-Z]?)$/;
  const BOM_RANGE_RE = /^([A-Z]{1,5}\d{1,6})[-~]([A-Z]{0,5}\d{1,6})$/;
  const BOM_SPLIT_RE = /[,;\s/|]+/;
  const SMT_TOKEN_SPLIT_RE = /[\s,;|]+/;
  const VALUE_RE = /^[\d.]+[A-Z]{0,4}%?$|^\d+[RKMUNP]\d*[A-Z]{0,3}$/;
  const DNP_RE = /\b(DNP|DNI|DNF|DNL|NOPOP|NO\s*POP|NOT\s+FITTED|NOT\s+POPULATED|NOT\s+MOUNTED|NO\s+LOAD|DO\s+NOT\s+(?:POPULATE|PLACE|INSTALL|FIT|MOUNT|STUFF))\b/;

  const T = {
    MISSING_SMT: "Missing in SMT",
    MISSING_BOM: "Missing in BOM",
    MPN_MISMATCH: "MPN Mismatch",
    DUP_BOM: "Duplicate in BOM",
    DUP_SMT: "Duplicate in SMT",
  };
  const ALL_TYPES = [T.MISSING_SMT, T.MISSING_BOM, T.MPN_MISMATCH, T.DUP_BOM, T.DUP_SMT];

  class AppError extends Error {
    constructor(message, title) { super(message); this.title = title || "Error"; }
  }

  /* ---------------------------------------------------------------- helpers */
  function cellText(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") {
      if (!isFinite(v)) return "";
      return Number.isInteger(v) ? String(v) : String(v);
    }
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).replace(/[\r\n]+/g, " ").trim();
  }
  const normalizeMpn = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  function refPrefix(ref) { const m = GENERIC_REF_RE.exec(ref); return m ? m[1] : ref; }
  function naturalKey(ref) {
    const m = GENERIC_REF_RE.exec(ref);
    return m ? [m[1], parseInt(m[2], 10), m[3]] : [ref, 0, ""];
  }
  function naturalCompare(a, b) {
    const ka = naturalKey(a), kb = naturalKey(b);
    if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    return ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0;
  }
  function unique(items) {
    const seen = new Set(), out = [];
    for (const it of items) if (it && !seen.has(it)) { seen.add(it); out.push(it); }
    return out;
  }
  function colLetter(i) {
    let s = ""; i += 1;
    while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function lettersToIndex(l) {
    let idx = 0;
    for (const ch of l.toUpperCase()) idx = idx * 26 + (ch.charCodeAt(0) - 64);
    return idx - 1;
  }
  function parsePrefixList(text) {
    return unique(String(text || "").split(/[,;\s]+/).map((p) => p.trim().toUpperCase()).filter((p) => /^[A-Z]+$/.test(p)));
  }

  function expandRange(start, end) {
    const ms = GENERIC_REF_RE.exec(start);
    if (!ms) return null;
    const pre = ms[1], numS = ms[2], suf = ms[3];
    let ePre, eNumS, eSuf;
    if (/^\d+$/.test(end)) { ePre = pre; eNumS = end; eSuf = ""; }
    else {
      const me = GENERIC_REF_RE.exec(end);
      if (!me) return null;
      ePre = me[1]; eNumS = me[2]; eSuf = me[3];
    }
    const n = parseInt(numS, 10), e = parseInt(eNumS, 10);
    if (ePre !== pre || suf || eSuf || e < n || e - n > MAX_RANGE_EXPANSION) return null;
    const width = numS.startsWith("0") && numS.length > 1 ? numS.length : 0;
    const out = [];
    for (let i = n; i <= e; i++) out.push(pre + (width ? String(i).padStart(width, "0") : String(i)));
    return out;
  }

  function splitBomDesignators(text) {
    let t = String(text || "").toUpperCase()
      .replace(/–|—/g, "-").replace(/ /g, " ")
      .replace(/\s*([-~])\s*/g, "$1")
      .replace(/["'()[\]{}]/g, " ");
    const refs = [], bad = [];
    for (let tok of t.split(BOM_SPLIT_RE)) {
      tok = tok.replace(/^[.:\-~]+|[.:\-~]+$/g, "");
      if (!tok) continue;
      if (GENERIC_REF_RE.test(tok)) { refs.push(tok); continue; }
      const m = BOM_RANGE_RE.exec(tok);
      if (m) {
        const ex = expandRange(m[1], m[2]);
        if (ex) { refs.push(...ex); continue; }
      }
      bad.push(tok);
    }
    return { refs, bad };
  }

  /* -------------------------------------------------------------- BOM parse */
  function isRefHeader(h) {
    h = h.trim().toLowerCase();
    return ["designator", "refdes", "ref des", "ref. des", "reference"].some((k) => h.includes(k)) ||
      ["ref", "refs", "ref.", "location", "locations", "position", "positions", "ref no", "ref no."].includes(h);
  }
  function isMpnHeader(h, strong) {
    h = h.trim().toLowerCase();
    const keys = ["mpn", "manufacturer part", "mfr part", "mfg part", "mfr p/n", "mfg p/n", "manufacturer p/n",
      "mfr. part", "mfr pn", "mfg pn", "manufacturer pn"];
    if (strong) return keys.some((k) => h.includes(k));
    return ["part number", "part no", "part no.", "p/n", "pn", "part #", "part"].includes(h) || h.includes("part number");
  }
  function isDescHeader(h) {
    h = h.trim().toLowerCase();
    return h.includes("description") || ["desc", "desc.", "comment", "value"].includes(h);
  }
  function guessColumn(headers, kind) {
    if (kind === "ref") return headers.find(isRefHeader) || null;
    if (kind === "mpn") return headers.find((h) => isMpnHeader(h, true)) || headers.find((h) => isMpnHeader(h, false)) || null;
    if (kind === "desc") return headers.find(isDescHeader) || null;
    return null;
  }

  function detectHeaderRow(raw, scan = 40) {
    let bestIdx = 0, bestScore = 0;
    for (let i = 0; i < Math.min(scan, raw.length); i++) {
      const cells = (raw[i] || []).map(cellText).filter(Boolean);
      if (!cells.length) continue;
      const hasRef = cells.some(isRefHeader);
      let score = hasRef ? 3 : 0;
      if (cells.some((c) => isMpnHeader(c, true) || isMpnHeader(c, false))) score += 2;
      if (cells.some(isDescHeader)) score += 1;
      if (hasRef && score >= 4) return i;
      if (score > bestScore) { bestIdx = i; bestScore = score; }
    }
    return bestIdx;
  }

  function buildHeaders(raw, idx) {
    const width = raw.reduce((w, r) => Math.max(w, (r || []).length), 0);
    const row = raw[idx] || [];
    const seen = {}, names = [];
    for (let j = 0; j < width; j++) {
      let name = cellText(row[j]) || `Column ${colLetter(j)}`;
      if (seen[name]) { seen[name] += 1; name = `${name} (${seen[name]})`; } else seen[name] = 1;
      names.push(name);
    }
    return names;
  }

  function peekHeaders(raw, headerRow) {
    if (!raw.length || raw.every((r) => !(r || []).some((c) => cellText(c))))
      throw new AppError("The selected sheet appears to be empty.", "Parsing Error");
    const idx = headerRow > 0 ? headerRow - 1 : detectHeaderRow(raw);
    if (idx >= raw.length) throw new AppError(`Header row ${idx + 1} is beyond the end of the sheet.`, "Column Not Found");
    return { headers: buildHeaders(raw, idx), idx };
  }

  function resolveColumn(headers, spec, label, required) {
    spec = String(spec || "").trim();
    if (!spec || spec === NONE_OPTION) {
      if (required) throw new AppError(`No column was specified for "${label}".`, "Column Not Found");
      return null;
    }
    const lower = spec.toLowerCase();
    const exact = headers.findIndex((h) => h.trim().toLowerCase() === lower);
    if (exact >= 0) return exact;
    if (/^\d+$/.test(spec)) { const i = parseInt(spec, 10) - 1; if (i >= 0 && i < headers.length) return i; }
    if (/^[A-Za-z]{1,3}$/.test(spec)) { const i = lettersToIndex(spec); if (i >= 0 && i < headers.length) return i; }
    const partial = headers.map((h, i) => (h.toLowerCase().includes(lower) ? i : -1)).filter((i) => i >= 0);
    if (partial.length === 1) return partial[0];
    const avail = headers.map((h, i) => `  ${colLetter(i)} (${i + 1}): ${h}`).join("\n");
    throw new AppError(
      `Could not find the "${label}" column using "${spec}".\n\nEnter a header name, a 1-based column number, or an Excel column letter.\n\nAvailable columns:\n${avail}`,
      "Column Not Found");
  }

  function loadBom(raw, opts) {
    if (!raw.length || raw.every((r) => !(r || []).some((c) => cellText(c))))
      throw new AppError("The selected BOM sheet is empty.", "Parsing Error");
    const headerIdx = opts.headerRow > 0 ? opts.headerRow - 1 : detectHeaderRow(raw);
    if (headerIdx >= raw.length)
      throw new AppError(`Header row ${headerIdx + 1} is beyond the end of the sheet (${raw.length} rows).`, "Column Not Found");
    const headers = buildHeaders(raw, headerIdx);
    const refI = resolveColumn(headers, opts.refCol, "Reference Designators", true);
    const mpnI = resolveColumn(headers, opts.mpnCol, "Manufacturer Part Number", true);
    const descI = resolveColumn(headers, opts.descCol, "Description", false);
    if (refI === mpnI) throw new AppError("The Reference Designator and MPN selections point to the same column.", "Column Not Found");

    const data = { entries: new Map(), dnpRefs: new Map(), invalidTokens: [], headerRow: headerIdx + 1,
      columns: { ref: headers[refI], mpn: headers[mpnI], desc: descI !== null ? headers[descI] : "" } };

    let prevMpn = "", prevDesc = "";
    for (let r = headerIdx + 1; r < raw.length; r++) {
      const excelRow = r + 1;
      const cells = (raw[r] || []).map(cellText);
      const refTxt = cells[refI] || "";
      let mpn = cells[mpnI] || "";
      let desc = descI !== null ? cells[descI] || "" : "";

      if (!refTxt) { if (mpn || desc) { prevMpn = mpn; prevDesc = desc; } continue; }

      let inherited = false;
      if (!mpn && !desc && prevMpn) {
        const others = cells.filter((c, j) => j !== refI && c);
        if (!others.length) { mpn = prevMpn; desc = prevDesc; inherited = true; }
      }

      const { refs, bad } = splitBomDesignators(refTxt);
      for (const b of bad) if (!DNP_RE.test(b)) data.invalidTokens.push([excelRow, b]);
      if (!refs.length) continue;

      if (opts.excludeDnp && cells.some((c) => c && DNP_RE.test(c.toUpperCase()))) {
        for (const ref of refs) if (!data.dnpRefs.has(ref)) data.dnpRefs.set(ref, excelRow);
        continue;
      }
      for (const ref of refs) {
        if (!data.entries.has(ref)) data.entries.set(ref, []);
        data.entries.get(ref).push({ ref, mpn, desc, row: excelRow, inherited });
      }
      if (mpn) { prevMpn = mpn; prevDesc = desc; }
    }

    if (!data.entries.size && !data.dnpRefs.size)
      throw new AppError(
        `No reference designators were found in column "${headers[refI]}" (header row ${headerIdx + 1}).\n\nCheck that the correct sheet, header row and designator column are selected.`,
        "Parsing Error");
    return data;
  }

  /* -------------------------------------------------------------- SMT parse */
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  class SmtScanner {
    constructor(prefixes) {
      const clean = [...new Set([...prefixes].map((p) => String(p).trim().toUpperCase()).filter((p) => /^[A-Z]+$/.test(p)))]
        .sort((a, b) => b.length - a.length);
      if (!clean.length) throw new AppError("No valid designator prefixes were configured for the SMT scan.", "Configuration Error");
      this.prefixes = new Set(clean);
      const alt = clean.map(esc).join("|");
      const body = `((?:${alt})\\d{1,6}[A-Z]?)(?:[-~]((?:${alt})?\\d{1,6}))?`;
      this.scanSrc = `(?<![A-Z0-9_.\\-])${body}(?![A-Z0-9_\\-])`;
      this.fullRe = new RegExp(`^${body}$`);
    }
    static valid(ref) { const m = GENERIC_REF_RE.exec(ref); return !!m && !PACKAGE_CODES.has(m[2]); }
    find(line) {
      const refs = [], re = new RegExp(this.scanSrc, "g");
      let m;
      while ((m = re.exec(line))) {
        const start = m[1], end = m[2];
        let cands;
        if (end) {
          const ex = SmtScanner.valid(start) ? expandRange(start, end) : null;
          if (ex) { refs.push(...ex); continue; }
          cands = /^\d+$/.test(end) ? [start] : [start, end];
        } else cands = [start];
        for (const c of cands) if (SmtScanner.valid(c)) refs.push(c);
      }
      return refs;
    }
    isDesignatorToken(tok) { return this.fullRe.test(tok); }
    guessMpn(tokens, bomNorms) {
      for (const tok of tokens) { const n = normalizeMpn(tok); if (n.length >= 4 && bomNorms.has(n)) return tok; }
      let best = null, bestLen = 0;
      for (const tok of tokens) {
        if (this.isDesignatorToken(tok) || VALUE_RE.test(tok)) continue;
        const n = normalizeMpn(tok);
        if (n.length < 6 || !/[A-Z]/.test(n) || !/\d/.test(n)) continue;
        if (n.length > bestLen) { best = tok; bestLen = n.length; }
      }
      return best;
    }
  }

  /** lines: array of {loc, text} */
  function parseSmt(lines, scanner, bomNorms) {
    const data = new Map();
    let lastMpn = null, lastCtx = "", lastIdx = -999;
    lines.forEach(({ loc, text }, idx) => {
      const line = String(text).toUpperCase().trim();
      if (!line) return;
      const refs = scanner.find(line);
      const tokens = line.split(SMT_TOKEN_SPLIT_RE).map((t) => t.replace(/^["'()[\]{}:]+|["'()[\]{}:]+$/g, "")).filter(Boolean);
      let mpn = scanner.guessMpn(tokens, bomNorms);
      let ctx = String(text).trim(), inherited = false;
      if (mpn) { lastMpn = mpn; lastCtx = ctx; lastIdx = idx; }
      else if (refs.length && lastMpn && idx - lastIdx <= 3) {
        mpn = lastMpn; inherited = true; ctx = `${lastCtx}  ⏎  ${ctx}`; lastIdx = idx;
      }
      for (const r of refs) {
        if (!data.has(r)) data.set(r, []);
        data.get(r).push({ ref: r, mpn: mpn || "", location: loc, context: ctx, inherited });
      }
    });
    return data;
  }

  function parseSmtColumns(lines, scanner, bomNorms, refCol, mpnCol) {
    if (refCol < 1) throw new AppError("Setup RefDes column must be 1 or greater.", "Configuration Error");
    const data = new Map();
    let lastMpn = null, lastCtx = "", lastIdx = -999;
    lines.forEach(({ loc, text }, idx) => {
      const raw = String(text).trim();
      if (!raw) return;
      const parts = raw.split(/\t+|\s{2,}|\|/);
      if (refCol > parts.length) return;
      const refs = unique(scanner.find(parts[refCol - 1].toUpperCase()));
      if (!refs.length) return;
      let mpn = "";
      if (mpnCol >= 1 && mpnCol <= parts.length) {
        const cand = parts[mpnCol - 1].trim();
        if (cand && !scanner.find(cand.toUpperCase()).length) mpn = cand;
      }
      if (!mpn) {
        const tokens = raw.toUpperCase().split(SMT_TOKEN_SPLIT_RE).map((t) => t.replace(/^["'()[\]{}:]+|["'()[\]{}:]+$/g, "")).filter(Boolean);
        mpn = scanner.guessMpn(tokens, bomNorms) || "";
      }
      let inherited = false, ctx = raw;
      if (mpn) { lastMpn = mpn; lastCtx = ctx; lastIdx = idx; }
      else if (lastMpn && idx - lastIdx <= 3) {
        mpn = lastMpn; inherited = true; ctx = `${lastCtx}  ⏎  ${ctx}`; lastIdx = idx;
      }
      for (const r of refs) {
        if (!data.has(r)) data.set(r, []);
        data.get(r).push({ ref: r, mpn: mpn || "", location: loc, context: ctx, inherited });
      }
    });
    return data;
  }

  /* ------------------------------------------------------------- comparison */
  function compareData(bom, smt, scanPrefixes, opts) {
    const ignore = new Set([...opts.ignorePrefixes].map((p) => p.toUpperCase()));
    const bomRefs = new Set([...bom.entries.keys()].filter((r) => !ignore.has(refPrefix(r))));
    const smtRefs = new Set([...smt.keys()].filter((r) => !ignore.has(refPrefix(r))));
    const rows = [], stats = Object.fromEntries(ALL_TYPES.map((t) => [t, 0]));
    let verified = 0, unverified = 0;
    const add = (ref, type, bomMpn = "", smtMpn = "", notes = "", desc = "", src = "") => {
      rows.push({ ref, type, bomMpn, smtMpn, notes, desc, src }); stats[type] += 1;
    };

    const all = [...new Set([...bomRefs, ...smtRefs])].sort(naturalCompare);
    for (const ref of all) {
      const b = bomRefs.has(ref) ? bom.entries.get(ref) || [] : [];
      const s = smtRefs.has(ref) ? smt.get(ref) || [] : [];
      const bMpn = unique(b.map((e) => e.mpn)).join("; ");
      const bDesc = unique(b.map((e) => e.desc)).join("; ");
      const sMpn = unique(s.map((e) => e.mpn)).join("; ");
      const sSrc = unique(s.map((e) => e.location)).join("; ");

      if (b.length > 1) {
        const distinct = new Set(b.map((e) => normalizeMpn(e.mpn))).size;
        let note = `Listed ${b.length} times in BOM (rows ${b.map((e) => e.row).join(", ")})`;
        note += distinct > 1 ? " with DIFFERENT part numbers." : ".";
        add(ref, T.DUP_BOM, bMpn, sMpn, note, bDesc, sSrc);
      }
      const sNorms = new Set(s.filter((e) => e.mpn).map((e) => normalizeMpn(e.mpn)));
      if (sNorms.size > 1)
        add(ref, T.DUP_SMT, bMpn, sMpn, `Designator appears on ${s.length} setup entries with different parts.`, bDesc, sSrc);

      if (b.length && !s.length) {
        let note = "Present in BOM but not found on the SMT setup sheet.";
        if (!scanPrefixes.has(refPrefix(ref))) note += ` Prefix '${refPrefix(ref)}' is not in the SMT scan list.`;
        if (b.some((e) => e.inherited)) note += " (BOM MPN inherited from previous row.)";
        add(ref, T.MISSING_SMT, bMpn, "", note, bDesc, "");
      } else if (s.length && !b.length) {
        const note = bom.dnpRefs.has(ref)
          ? `Marked DNP / not fitted in BOM (row ${bom.dnpRefs.get(ref)}) but loaded on the SMT setup.`
          : "Found on the SMT setup sheet but not in the BOM.";
        add(ref, T.MISSING_BOM, "", sMpn, note, "", sSrc);
      } else if (b.length && s.length && opts.checkMpn) {
        const bomNorms = b.map((e) => normalizeMpn(e.mpn)).filter(Boolean);
        if (!bomNorms.length) continue;
        const descNorms = b.map((e) => normalizeMpn(e.desc)).filter((n) => n.length >= 6);
        let ok = false;
        for (const e of s) {
          const ctxN = normalizeMpn(e.context), smN = normalizeMpn(e.mpn);
          if (bomNorms.some((n) => (n.length >= 4 && ctxN.includes(n)) || (smN && n === smN))) ok = true;
          else if (descNorms.some((d) => ctxN.includes(d))) ok = true;
          if (ok) break;
        }
        if (ok) verified++;
        else if (sMpn) {
          let note = `BOM MPN not found on the setup line(s) at ${sSrc}; setup sheet shows '${sMpn}'.`;
          if (s.some((e) => e.inherited)) note += " (SMT part number taken from the preceding line.)";
          add(ref, T.MPN_MISMATCH, bMpn, sMpn, note, bDesc, sSrc);
        } else unverified++;
      }
    }
    Object.assign(stats, {
      bomRefs: bomRefs.size, smtRefs: smtRefs.size,
      common: [...bomRefs].filter((r) => smtRefs.has(r)).length,
      mpnVerified: verified, mpnUnverified: unverified, dnpExcluded: bom.dnpRefs.size, total: rows.length,
    });
    return { rows, stats };
  }

  /** raw: BOM sheet as array of arrays; lines: [{loc,text}] */
  function runComparison(raw, lines, opts) {
    const bom = loadBom(raw, opts);
    if (!lines.some((l) => String(l.text).trim())) throw new AppError("The SMT setup sheet is empty.", "Parsing Error");
    const prefixes = new Set(opts.prefixes);
    if (opts.learnPrefixes) for (const r of [...bom.entries.keys(), ...bom.dnpRefs.keys()]) prefixes.add(refPrefix(r));
    const scanner = new SmtScanner(prefixes);
    const bomNorms = new Set();
    for (const es of bom.entries.values()) for (const e of es) { const n = normalizeMpn(e.mpn); if (n.length >= 4) bomNorms.add(n); }
    const smt = opts.smtColumnMode
      ? parseSmtColumns(lines, scanner, bomNorms, opts.smtRefCol || 6, opts.smtMpnCol || 0)
      : parseSmt(lines, scanner, bomNorms);
    if (!smt.size) {
      const extra = opts.smtColumnMode
        ? `\n\nColumn mode is on (designators in column ${opts.smtRefCol}, MPN in column ${opts.smtMpnCol}). Turn it off for free-form sheets, or change the column numbers.`
        : "";
      throw new AppError(
        "No reference designators were found in the SMT setup sheet.\n\nCheck that the correct file was selected and that the designator prefixes (e.g. R, C, U) match the ones used on the sheet." + extra,
        "Parsing Error");
    }
    const { rows, stats } = compareData(bom, smt, scanner.prefixes, opts);
    const warnings = [];
    if (bom.invalidTokens.length) {
      const sample = bom.invalidTokens.slice(0, 40).map(([r, t]) => `  Row ${r}: '${t}'`).join("\n");
      const more = bom.invalidTokens.length > 40 ? `\n  … and ${bom.invalidTokens.length - 40} more` : "";
      warnings.push(`${bom.invalidTokens.length} token(s) in the BOM designator column were not recognised as designators and were ignored:\n${sample}${more}`);
    }
    return { rows, stats, warnings, headerRow: bom.headerRow, columns: bom.columns };
  }

  /* --------------------------------------------------------- text decoding */
  function decodeText(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder("utf-16le").decode(u8.subarray(2));
    if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder("utf-16be").decode(u8.subarray(2));
    const head = u8.subarray(0, 2000);
    if (head.includes(0)) {
      // Guess UTF-16 without BOM: zeros in odd positions => LE
      let odd = 0, even = 0;
      for (let i = 0; i < head.length; i++) if (head[i] === 0) (i % 2 ? odd++ : even++);
      return new TextDecoder(odd >= even ? "utf-16le" : "utf-16be").decode(u8);
    }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(u8).replace(/^﻿/, ""); }
    catch (e) { return new TextDecoder("windows-1252").decode(u8); }
  }

  /** Rebuild text lines from pdf.js text items of one page. */
  function pdfItemsToLines(items) {
    const pts = items.filter((it) => it.str !== undefined && it.transform)
      .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 10 }));
    pts.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const p of pts) {
      const row = rows.find((r) => Math.abs(r.y - p.y) <= Math.max(2, p.h * 0.35));
      if (row) row.items.push(p); else rows.push({ y: p.y, items: [p] });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) => {
      r.items.sort((a, b) => a.x - b.x);
      let out = "", lastEnd = null;
      for (const it of r.items) {
        if (lastEnd !== null) {
          const gap = it.x - lastEnd;
          if (gap > it.h * 0.15 && !/\s$/.test(out) && !/^\s/.test(it.s)) out += gap > it.h * 1.2 ? "  " : " ";
        }
        out += it.s;
        lastEnd = it.x + it.w;
      }
      return out;
    });
  }

  root.BomCore = {
    DEFAULT_PREFIXES, NONE_OPTION, T, ALL_TYPES, AppError,
    cellText, normalizeMpn, refPrefix, naturalCompare, colLetter, parsePrefixList,
    splitBomDesignators, expandRange, guessColumn, detectHeaderRow, peekHeaders, resolveColumn,
    loadBom, SmtScanner, parseSmt, parseSmtColumns, compareData, runComparison, decodeText, pdfItemsToLines,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.BomCore;
})(typeof window !== "undefined" ? window : globalThis);
