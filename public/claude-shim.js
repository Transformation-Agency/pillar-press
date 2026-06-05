/* claude-shim.js
 * Provides window.claude.complete() for running Pillar Press OUTSIDE the design
 * environment. It posts to this app's own /api/claude proxy (server.js), which
 * calls Anthropic with a SERVER-SIDE key. If a host already injected
 * window.claude (e.g. the design tool), this leaves it untouched.
 *
 * Contract (matches the design environment):
 *   await window.claude.complete("a string")
 *   await window.claude.complete({ messages: [...], system?: "..." })
 *   -> resolves to a plain string (the model's text).
 */
(function () {
  if (window.claude && typeof window.claude.complete === "function") return;

  async function complete(arg) {
    const payload = typeof arg === "string" ? { messages: [{ role: "user", content: arg }] } : (arg || {});
    let res;
    try {
      res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw new Error("Could not reach the local Claude proxy. Is server.js running?");
    }
    if (!res.ok) {
      let msg = "Claude proxy error " + res.status;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
      // 503 = no ANTHROPIC_API_KEY configured on the server
      throw new Error(msg);
    }
    const j = await res.json();
    return j.text || "";
  }

  window.claude = { complete: complete };
})();
