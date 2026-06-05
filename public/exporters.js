/* ============================================================
   Exporters — markdown builders, file download, and a tiny
   (store / no-compression) ZIP so "Download all" yields one
   file per platform. Plain JS. Exposes window.EXPORT.
   ============================================================ */
(function () {

  function outputMarkdown(o) {
    const L = [];
    L.push(`# ${o.platform}`);
    L.push("");
    L.push(`- **Audience:** ${o.selectedAudience}`);
    L.push(`- **Throughline:** #${o.throughlineTag}`);
    L.push(`- **Strategic purpose:** ${o.strategicPurpose}`);
    L.push("");
    L.push(`## Post`);
    L.push("");
    L.push(o.draftPost || "");
    L.push("");
    L.push(`## Hook options`);
    (o.hooks || []).forEach((h) => L.push(`- ${h}`));
    L.push("");
    L.push(`## CTA options`);
    (o.ctas || []).forEach((c) => L.push(`- ${c}`));
    L.push("");
    L.push(`## Production`);
    L.push(`- **Imagery / media:** ${o.mediaRec}`);
    L.push(`- **Risk & boundary:** ${o.riskCheck}`);
    L.push(`- **Related offering:** ${o.relatedOffering}`);
    L.push(`- **Suggested follow-up:** ${o.followUp}`);
    L.push("");
    return L.join("\n");
  }

  function pieceOutputsMarkdown(piece) {
    const L = [`# ${piece.title} — Platform outputs`, ""];
    (piece.outputOrder || []).forEach((pid) => {
      const o = piece.outputs[pid]; if (!o) return;
      L.push("---", "", outputMarkdown(o), "");
    });
    return L.join("\n");
  }

  // Assemble a whole campaign (= book) from its chapters (= pieces), in order.
  // Canonical chapter text = the saved draft (`original`); fall back to an
  // un-accepted proposed revision only when the draft is empty. Mirrors the
  // server port in lib/exporters.ts#bookMarkdown (byte-identical output).
  function bookMarkdown(campaign, chapters) {
    const title = (campaign && campaign.name) || "Untitled book";
    const L = [`# ${title}`, ""];
    (chapters || []).forEach((c, i) => {
      const text = (c.original && c.original.trim())
        ? c.original
        : ((c.revision && c.revision.text) || "");
      if (i > 0) L.push("", "---", "");
      L.push(`## ${c.title || ("Chapter " + (i + 1))}`, "", text, "");
    });
    return L.join("\n");
  }

  function safeName(s) { return (s || "untitled").replace(/[^a-z0-9\-_ ]/gi, "").replace(/\s+/g, "-").slice(0, 60) || "untitled"; }

  function blobFor(text, mime) { return new Blob([text], { type: mime || "text/markdown;charset=utf-8" }); }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
  }

  function downloadText(text, filename, mime) { downloadBlob(blobFor(text, mime), filename); }

  /* ---- minimal ZIP (store method) ---- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function strBytes(s) { return new TextEncoder().encode(s); }
  function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
  function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }

  // files: [{name, content(string)}]
  function zipBlob(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    files.forEach((f) => {
      const nameB = strBytes(f.name);
      const dataB = strBytes(f.content);
      const crc = crc32(dataB);
      const local = [].concat(
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(dataB.length), u32(dataB.length), u16(nameB.length), u16(0)
      );
      const localHead = new Uint8Array(local);
      chunks.push(localHead, nameB, dataB);
      const localSize = localHead.length + nameB.length + dataB.length;
      const cen = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(dataB.length), u32(dataB.length), u16(nameB.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)
      );
      central.push(new Uint8Array(cen), nameB);
      offset += localSize;
    });
    let centralSize = 0;
    central.forEach((c) => centralSize += c.length);
    const end = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralSize), u32(offset), u16(0)
    ));
    return new Blob([...chunks, ...central, end], { type: "application/zip" });
  }

  window.EXPORT = { outputMarkdown, pieceOutputsMarkdown, bookMarkdown, safeName, downloadText, downloadBlob, blobFor, zipBlob };
})();
