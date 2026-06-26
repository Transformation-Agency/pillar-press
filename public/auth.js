/* Hosted Auth — Supabase Auth REST client + same-origin API bearer headers.
   Desktop/local-first mode stays unauthenticated and does not use this path. */
(function () {
  const STORAGE_KEY = "kp_hosted_auth_session_v1";
  const listeners = new Set();
  const nativeFetch = window.fetch.bind(window);

  let config = null;
  let session = loadSession();
  let user = null;
  let ready = false;
  let lastError = null;
  let recovery = readRecoveryFragment();

  function loadSession() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveSession(next) {
    session = normalizeSession(next);
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
    emit();
  }

  function normalizeSession(raw) {
    if (!raw || !raw.access_token) return null;
    const now = Math.floor(Date.now() / 1000);
    return Object.assign({}, raw, {
      expires_at: raw.expires_at || (raw.expires_in ? now + Number(raw.expires_in) : now + 3600),
    });
  }

  function readRecoveryFragment() {
    if (!window.location || !window.location.hash) return null;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    if (params.get("type") !== "recovery") return null;
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken) return null;
    try {
      window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
    } catch { /* ignore */ }
    return {
      access_token: accessToken,
      refresh_token: refreshToken || "",
      token_type: params.get("token_type") || "bearer",
      expires_in: Number(params.get("expires_in") || 3600),
      type: "recovery",
    };
  }

  function snapshot() {
    const requiresLogin = Boolean(config && config.requiresLogin);
    return {
      ready,
      hosted: Boolean(config && config.hosted),
      requiresLogin,
      authDisabled: Boolean(config && config.authDisabled),
      configured: Boolean(config && config.ready),
      authenticated: !requiresLogin || Boolean(session && session.access_token),
      recovery: Boolean(recovery && recovery.access_token),
      user,
      error: lastError,
    };
  }

  function emit() {
    const snap = snapshot();
    listeners.forEach((listener) => {
      try { listener(snap); } catch (err) { console.warn("[Auth] listener failed:", err); }
    });
  }

  function authEndpoint(path) {
    if (!config || !config.supabaseUrl) throw new Error("Hosted auth is not configured.");
    return config.supabaseUrl.replace(/\/+$/, "") + path;
  }

  function currentAuthRedirect() {
    return window.location.origin + window.location.pathname;
  }

  async function supabaseJson(path, body) {
    const anon = config && config.supabaseAnonKey;
    if (!anon) throw new Error("Supabase anon key is missing.");
    const response = await nativeFetch(authEndpoint(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        apikey: anon,
      },
      body: JSON.stringify(body || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error_description || data.msg || data.error || "Authentication failed.");
    }
    return data;
  }

  async function supabaseAuthorizedJson(path, token, method, body) {
    const anon = config && config.supabaseAnonKey;
    if (!anon) throw new Error("Supabase anon key is missing.");
    const response = await nativeFetch(authEndpoint(path), {
      method: method || "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        apikey: anon,
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error_description || data.msg || data.error || "Authentication failed.");
    }
    return data;
  }

  async function refreshSession() {
    if (!session || !session.refresh_token) return null;
    const refreshed = await supabaseJson("/auth/v1/token?grant_type=refresh_token", {
      refresh_token: session.refresh_token,
    });
    saveSession(refreshed);
    return session && session.access_token;
  }

  async function accessToken() {
    if (!config || !config.requiresLogin) return null;
    if (!session || !session.access_token) return null;
    const now = Math.floor(Date.now() / 1000);
    if (session.expires_at && Number(session.expires_at) - now < 60) {
      try {
        return await refreshSession();
      } catch (err) {
        lastError = err && err.message ? err.message : "Session refresh failed.";
        saveSession(null);
        return null;
      }
    }
    return session.access_token;
  }

  function shouldAttachAuth(input) {
    const raw = typeof input === "string" ? input : (input && input.url);
    if (!raw) return false;
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin) return false;
    if (!url.pathname.startsWith("/api/")) return false;
    if (url.pathname === "/api/auth/config") return false;
    return Boolean(config && config.requiresLogin);
  }

  function sameOriginApiPath(input) {
    const raw = typeof input === "string" ? input : (input && input.url);
    if (!raw) return null;
    try {
      const url = new URL(raw, window.location.href);
      if (url.origin !== window.location.origin) return null;
      if (!url.pathname.startsWith("/api/")) return null;
      return url.pathname;
    } catch {
      return null;
    }
  }

  async function observeApiResponse(input, response) {
    const path = sameOriginApiPath(input);
    if (!path || !response || response.status !== 402) return response;
    let data = {};
    try { data = await response.clone().json(); } catch { data = {}; }
    const billingCodes = [
      "quota_exceeded",
      "subscription_required",
      "subscription_inactive",
      "trial_expired",
      "campaign_limit_exceeded",
      "concurrent_job_limit_exceeded",
      "drive_not_enabled",
      "managed_provider_not_enabled",
      "byok_provider_not_enabled",
      "export_not_enabled",
      "storage_quota_exceeded",
    ];
    if (data && billingCodes.includes(data.code)) {
      window.dispatchEvent(new CustomEvent("pillarpress:billing-action-required", {
        detail: {
          path,
          status: response.status,
          code: data.code,
          error: data.error || "A subscription or upgrade is required.",
        },
      }));
    }
    return response;
  }

  window.fetch = async function authFetch(input, init) {
    if (!shouldAttachAuth(input)) return observeApiResponse(input, await nativeFetch(input, init));
    const token = await accessToken();
    if (!token) return observeApiResponse(input, await nativeFetch(input, init));

    const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
    if (!headers.has("Authorization")) headers.set("Authorization", "Bearer " + token);

    if (input instanceof Request) {
      const request = new Request(input, Object.assign({}, init || {}, { headers }));
      return observeApiResponse(request, await nativeFetch(request));
    }
    return observeApiResponse(input, await nativeFetch(input, Object.assign({}, init || {}, { headers })));
  };

  async function loadServerSession() {
    if (!config || !config.requiresLogin || !session) return null;
    const response = await window.fetch("/api/auth/session", { headers: { Accept: "application/json" } });
    if (!response.ok) {
      user = null;
      return null;
    }
    const data = await response.json();
    user = data.user || null;
    emit();
    return user;
  }

  async function init() {
    try {
      const response = await nativeFetch("/api/auth/config", { headers: { Accept: "application/json" } });
      config = response.ok ? await response.json() : { requiresLogin: false, ready: true };
      if (recovery && recovery.access_token && config.requiresLogin) saveSession(recovery);
      if (config.requiresLogin && session) await loadServerSession();
    } catch (err) {
      lastError = err && err.message ? err.message : "Could not load auth configuration.";
      config = { requiresLogin: false, ready: false };
    } finally {
      ready = true;
      emit();
    }
    return snapshot();
  }

  async function signIn(email, password) {
    if (!config || !config.requiresLogin) return snapshot();
    lastError = null;
    const data = await supabaseJson("/auth/v1/token?grant_type=password", { email, password });
    saveSession(data);
    await loadServerSession();
    return snapshot();
  }

  async function signUp(email, password) {
    if (!config || !config.requiresLogin) return snapshot();
    lastError = null;
    const redirectTo = currentAuthRedirect();
    const data = await supabaseJson("/auth/v1/signup?redirect_to=" + encodeURIComponent(redirectTo), { email, password });
    const nextSession = data.session || data;
    if (nextSession && nextSession.access_token) {
      saveSession(nextSession);
      await loadServerSession();
    }
    return Object.assign(snapshot(), {
      confirmationRequired: !(nextSession && nextSession.access_token),
    });
  }

  async function requestPasswordReset(email) {
    if (!config || !config.requiresLogin) return snapshot();
    lastError = null;
    const redirectTo = currentAuthRedirect();
    await supabaseJson("/auth/v1/recover?redirect_to=" + encodeURIComponent(redirectTo), { email });
    return snapshot();
  }

  async function updateRecoveredPassword(password) {
    if (!config || !config.requiresLogin) return snapshot();
    if (!recovery || !recovery.access_token) throw new Error("Password recovery link is missing or expired.");
    lastError = null;
    await supabaseAuthorizedJson("/auth/v1/user", recovery.access_token, "PUT", { password });
    recovery = null;
    saveSession(session);
    await loadServerSession();
    return Object.assign(snapshot(), { passwordUpdated: true });
  }

  async function signOut() {
    saveSession(null);
    user = null;
    emit();
    return snapshot();
  }

  window.KP_AUTH = {
    ready: init(),
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      try { listener(snapshot()); } catch { /* ignore */ }
      return () => listeners.delete(listener);
    },
    signIn,
    signUp,
    requestPasswordReset,
    updateRecoveredPassword,
    signOut,
    getAccessToken: accessToken,
  };
})();
