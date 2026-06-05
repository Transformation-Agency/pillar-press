/* ============================================================
   Drive — best-effort Google Drive upload via Google Identity
   Services token flow. Requires the user's own OAuth Client ID
   (stored in Settings) and an authorized JS origin. Fails
   gracefully with a clear message; callers fall back to download.
   Plain JS. Exposes window.DRIVE.
   ============================================================ */
(function () {
  let accessToken = null, tokenExp = 0;

  function config() { return (window.Store && window.Store.getSettings().drive) || { clientId: "", folderId: "" }; }
  function isConfigured() { return !!config().clientId; }

  async function loadGIS() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return;
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true; s.defer = true;
      s.onload = res;
      s.onerror = () => rej(new Error("Could not load Google sign-in (network blocked)."));
      document.head.appendChild(s);
    });
    // give the global a tick to attach
    let tries = 0;
    while (!(window.google && window.google.accounts && window.google.accounts.oauth2) && tries < 40) {
      await new Promise((r) => setTimeout(r, 50)); tries++;
    }
    if (!(window.google && window.google.accounts && window.google.accounts.oauth2)) throw new Error("Google sign-in did not initialize.");
  }

  async function getToken() {
    const cfg = config();
    if (!cfg.clientId) throw new Error("Link a Google Drive first (add your OAuth Client ID in Drive settings).");
    if (accessToken && Date.now() < tokenExp - 60000) return accessToken;
    await loadGIS();
    return await new Promise((resolve, reject) => {
      let settled = false;
      try {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: cfg.clientId,
          scope: "https://www.googleapis.com/auth/drive.file",
          callback: (resp) => {
            if (resp && resp.error) { reject(new Error("Drive authorization failed: " + resp.error)); return; }
            accessToken = resp.access_token;
            tokenExp = Date.now() + (resp.expires_in || 3600) * 1000;
            settled = true;
            resolve(accessToken);
          },
          error_callback: (err) => reject(new Error("Drive sign-in was blocked — this origin is likely not an authorized JavaScript origin for your OAuth client. (" + ((err && err.type) || "popup_blocked") + ")")),
        });
        client.requestAccessToken({ prompt: accessToken ? "" : "consent" });
        setTimeout(() => { if (!settled) reject(new Error("Drive sign-in timed out (popup blocked or origin not authorized).")); }, 60000);
      } catch (e) { reject(e); }
    });
  }

  async function uploadFile(name, content, mime) {
    const token = await getToken();
    const cfg = config();
    const meta = { name };
    if (cfg.folderId) meta.parents = [cfg.folderId];
    const boundary = "----pillarpress" + Math.random().toString(36).slice(2);
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mime || "text/markdown"}\r\n\r\n` +
      `${content}\r\n--${boundary}--`;
    const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "multipart/related; boundary=" + boundary },
      body,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("Drive upload failed (" + res.status + "). " + t.slice(0, 160));
    }
    return await res.json();
  }

  async function uploadMany(files, onProgress) {
    const results = [];
    for (let i = 0; i < files.length; i++) {
      if (onProgress) onProgress(i, files.length, files[i].name);
      results.push(await uploadFile(files[i].name, files[i].content, files[i].mime));
    }
    return results;
  }

  window.DRIVE = { isConfigured, config, uploadFile, uploadMany, getToken };
})();
