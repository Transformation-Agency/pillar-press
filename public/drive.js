/* ============================================================
   Drive — Google Drive upload via the server-side OAuth flow.
   The browser no longer holds an OAuth Client ID or access
   token; linking and uploading both go through same-origin
   /api/drive/* endpoints. Fails gracefully with a clear
   message; callers fall back to download.
   Plain JS. Exposes window.DRIVE.
   ============================================================ */
(function () {
  // Cached server status: { linked, folderId, folderName, localExportAvailable }.
  let status = { linked: false, folderId: "", folderName: "", localExportAvailable: false };
  let refreshing = null;

  async function refresh() {
    try {
      const res = await fetch("/api/drive/status");
      if (!res.ok) throw new Error("status " + res.status);
      const data = await res.json();
      status = {
        linked: !!data.linked,
        folderId: data.folderId || "",
        folderName: data.folderName || (data.localExportAvailable ? "Local exports" : ""),
        localExportAvailable: !!data.localExportAvailable,
      };
    } catch (e) {
      // Leave the last known status in place; treat failures as "not linked".
      if (!status.linked) status = { linked: false, folderId: "", folderName: "", localExportAvailable: false };
    }
    return status;
  }

  // Kick off an initial status fetch on load so isConfigured() has data soon.
  refreshing = refresh().finally(() => { refreshing = null; });

  function config() {
    return { folderId: status.folderId, folderName: status.folderName, localExportAvailable: status.localExportAvailable };
  }

  function isConfigured() {
    // Return the cached boolean immediately; trigger a background refresh so the
    // value becomes accurate on subsequent renders.
    if (!refreshing) { refreshing = refresh().finally(() => { refreshing = null; }); }
    return !!(status.linked || status.localExportAvailable);
  }

  async function uploadMany(files, onProgress) {
    if (!files || !files.length) return [];
    // Report progress as we hand each file to the server. The server uploads
    // the whole batch in one request, so emit progress before the call.
    for (let i = 0; i < files.length; i++) {
      if (onProgress) onProgress(i, files.length, files[i].name);
    }
    const payload = files.map((f) => ({
      name: f.name,
      content: f.content,
      mime: f.mime || "text/markdown",
    }));
    const res = await fetch("/api/drive/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: payload }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("Drive upload failed (" + res.status + "). " + t.slice(0, 160));
    }
    const data = await res.json();
    const out = (data && data.files) || [];
    // Mark progress complete.
    if (onProgress) onProgress(files.length, files.length, "");
    return out.map((f) => ({ name: f.name, webViewLink: f.webViewLink }));
  }

  async function uploadFile(name, content, mime) {
    const results = await uploadMany([{ name, content, mime }]);
    return results[0] || { name, webViewLink: "" };
  }

  // Save a generated media item (image/video/audio) to the linked Drive folder.
  // The server fetches the media bytes and uploads them (binary).
  async function uploadMediaFile(mediaId) {
    const res = await fetch("/api/drive/upload-media", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId }),
    });
    if (!res.ok) {
      let msg = "Drive save failed (" + res.status + ").";
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    const data = await res.json();
    return (data && data.file) || {};
  }

  window.DRIVE = { isConfigured, config, uploadFile, uploadMany, uploadMediaFile, refresh };
})();
