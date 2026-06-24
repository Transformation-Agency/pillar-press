import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone() {
      return jsonResponse(body, status);
    },
  };
}

describe("browser hosted auth client", () => {
  it("signs in, stores the hosted session, and loads the same-origin workspace session with a bearer token", async () => {
    const source = readFileSync(new URL("../public/auth.js", import.meta.url), "utf8");
    const stored: Record<string, string> = {};
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init });
      if (url === "/api/auth/config") {
        return jsonResponse({
          hosted: true,
          localFirst: false,
          authDisabled: false,
          requiresLogin: true,
          ready: true,
          supabaseUrl: "https://example.supabase.co",
          supabaseAnonKey: "anon-public-key",
        });
      }
      if (url === "https://example.supabase.co/auth/v1/token?grant_type=password") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          email: "paul@example.com",
          password: "correct-password",
        });
        expect((init?.headers as Record<string, string>).apikey).toBe("anon-public-key");
        return jsonResponse({
          access_token: "hosted-access-token",
          refresh_token: "hosted-refresh-token",
          token_type: "bearer",
          expires_in: 3600,
        });
      }
      if (url === "/api/auth/session") {
        const headers = init?.headers as Headers;
        expect(headers.get("Authorization")).toBe("Bearer hosted-access-token");
        return jsonResponse({
          authenticated: true,
          user: { id: "user_1", workspaceId: "workspace_1", role: "author" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const window = {
      fetch,
      localStorage: {
        getItem: (key: string) => stored[key] ?? null,
        setItem: (key: string, value: string) => { stored[key] = value; },
        removeItem: (key: string) => { delete stored[key]; },
      },
      location: {
        origin: "https://app.kingspress.test",
        pathname: "/",
        search: "",
        hash: "",
        href: "https://app.kingspress.test/",
      },
      history: { replaceState: vi.fn() },
      dispatchEvent: vi.fn(),
    };

    runInNewContext(source, {
      window,
      console,
      URL,
      URLSearchParams,
      Headers,
      Request,
      CustomEvent,
      document: { title: "King's Press" },
    });

    await (window as any).KP_AUTH.ready;
    const snapshot = await (window as any).KP_AUTH.signIn("paul@example.com", "correct-password");

    expect(snapshot).toMatchObject({
      ready: true,
      hosted: true,
      requiresLogin: true,
      authenticated: true,
      user: { id: "user_1", workspaceId: "workspace_1", role: "author" },
    });
    expect(stored.kp_hosted_auth_session_v1).toContain("hosted-access-token");
    expect(calls.map((call) => call.url)).toEqual([
      "/api/auth/config",
      "https://example.supabase.co/auth/v1/token?grant_type=password",
      "/api/auth/session",
    ]);
  });

  it("creates a hosted account with an explicit redirect and reports confirmation-required signup", async () => {
    const source = readFileSync(new URL("../public/auth.js", import.meta.url), "utf8");
    const stored: Record<string, string> = {};
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init });
      if (url === "/api/auth/config") {
        return jsonResponse({
          hosted: true,
          localFirst: false,
          authDisabled: false,
          requiresLogin: true,
          ready: true,
          supabaseUrl: "https://example.supabase.co",
          supabaseAnonKey: "anon-public-key",
        });
      }
      if (url === "https://example.supabase.co/auth/v1/signup?redirect_to=https%3A%2F%2Fapp.kingspress.test%2F") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          email: "new-author@example.com",
          password: "new-password",
        });
        expect((init?.headers as Record<string, string>).apikey).toBe("anon-public-key");
        return jsonResponse({ user: { id: "pending_user_1" } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const window = {
      fetch,
      localStorage: {
        getItem: (key: string) => stored[key] ?? null,
        setItem: (key: string, value: string) => { stored[key] = value; },
        removeItem: (key: string) => { delete stored[key]; },
      },
      location: {
        origin: "https://app.kingspress.test",
        pathname: "/",
        search: "",
        hash: "",
        href: "https://app.kingspress.test/",
      },
      history: { replaceState: vi.fn() },
      dispatchEvent: vi.fn(),
    };

    runInNewContext(source, {
      window,
      console,
      URL,
      URLSearchParams,
      Headers,
      Request,
      CustomEvent,
      document: { title: "King's Press" },
    });

    await (window as any).KP_AUTH.ready;
    const snapshot = await (window as any).KP_AUTH.signUp("new-author@example.com", "new-password");

    expect(snapshot).toMatchObject({
      ready: true,
      hosted: true,
      requiresLogin: true,
      authenticated: false,
      confirmationRequired: true,
    });
    expect(stored.kp_hosted_auth_session_v1).toBeUndefined();
    expect(calls.map((call) => call.url)).toEqual([
      "/api/auth/config",
      "https://example.supabase.co/auth/v1/signup?redirect_to=https%3A%2F%2Fapp.kingspress.test%2F",
    ]);
  });

  it("requests a hosted password reset email with an explicit redirect", async () => {
    const source = readFileSync(new URL("../public/auth.js", import.meta.url), "utf8");
    const stored: Record<string, string> = {};
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init });
      if (url === "/api/auth/config") {
        return jsonResponse({
          hosted: true,
          localFirst: false,
          authDisabled: false,
          requiresLogin: true,
          ready: true,
          supabaseUrl: "https://example.supabase.co",
          supabaseAnonKey: "anon-public-key",
        });
      }
      if (url === "https://example.supabase.co/auth/v1/recover?redirect_to=https%3A%2F%2Fapp.kingspress.test%2F") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ email: "author@example.com" });
        expect((init?.headers as Record<string, string>).apikey).toBe("anon-public-key");
        return jsonResponse({});
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const window = {
      fetch,
      localStorage: {
        getItem: (key: string) => stored[key] ?? null,
        setItem: (key: string, value: string) => { stored[key] = value; },
        removeItem: (key: string) => { delete stored[key]; },
      },
      location: {
        origin: "https://app.kingspress.test",
        pathname: "/",
        search: "",
        hash: "",
        href: "https://app.kingspress.test/",
      },
      history: { replaceState: vi.fn() },
      dispatchEvent: vi.fn(),
    };

    runInNewContext(source, {
      window,
      console,
      URL,
      URLSearchParams,
      Headers,
      Request,
      CustomEvent,
      document: { title: "King's Press" },
    });

    await (window as any).KP_AUTH.ready;
    const snapshot = await (window as any).KP_AUTH.requestPasswordReset("author@example.com");

    expect(snapshot).toMatchObject({
      ready: true,
      hosted: true,
      requiresLogin: true,
      authenticated: false,
    });
    expect(stored.kp_hosted_auth_session_v1).toBeUndefined();
    expect(calls.map((call) => call.url)).toEqual([
      "/api/auth/config",
      "https://example.supabase.co/auth/v1/recover?redirect_to=https%3A%2F%2Fapp.kingspress.test%2F",
    ]);
  });

  it("completes a recovery-link password update and hydrates the hosted session", async () => {
    const source = readFileSync(new URL("../public/auth.js", import.meta.url), "utf8");
    const stored: Record<string, string> = {};
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init });
      if (url === "/api/auth/config") {
        return jsonResponse({
          hosted: true,
          localFirst: false,
          authDisabled: false,
          requiresLogin: true,
          ready: true,
          supabaseUrl: "https://example.supabase.co",
          supabaseAnonKey: "anon-public-key",
        });
      }
      if (url === "/api/auth/session") {
        const headers = init?.headers as Headers;
        expect(headers.get("Authorization")).toBe("Bearer recovery-access-token");
        return jsonResponse({
          authenticated: true,
          user: { id: "user_1", workspaceId: "workspace_1", role: "author" },
        });
      }
      if (url === "https://example.supabase.co/auth/v1/user") {
        expect(init?.method).toBe("PUT");
        expect(JSON.parse(String(init?.body))).toEqual({ password: "updated-password" });
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer recovery-access-token");
        return jsonResponse({ user: { id: "user_1" } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const window = {
      fetch,
      localStorage: {
        getItem: (key: string) => stored[key] ?? null,
        setItem: (key: string, value: string) => { stored[key] = value; },
        removeItem: (key: string) => { delete stored[key]; },
      },
      location: {
        origin: "https://app.kingspress.test",
        pathname: "/",
        search: "",
        hash: "#type=recovery&access_token=recovery-access-token&refresh_token=recovery-refresh-token&expires_in=3600",
        href: "https://app.kingspress.test/#type=recovery&access_token=recovery-access-token",
      },
      history: { replaceState: vi.fn() },
      dispatchEvent: vi.fn(),
    };

    runInNewContext(source, {
      window,
      console,
      URL,
      URLSearchParams,
      Headers,
      Request,
      CustomEvent,
      document: { title: "King's Press" },
    });

    const readySnapshot = await (window as any).KP_AUTH.ready;
    expect(readySnapshot).toMatchObject({
      ready: true,
      hosted: true,
      requiresLogin: true,
      authenticated: true,
      recovery: true,
    });

    const updated = await (window as any).KP_AUTH.updateRecoveredPassword("updated-password");

    expect(updated).toMatchObject({
      ready: true,
      hosted: true,
      requiresLogin: true,
      authenticated: true,
      recovery: false,
      passwordUpdated: true,
      user: { id: "user_1", workspaceId: "workspace_1", role: "author" },
    });
    expect(stored.kp_hosted_auth_session_v1).toContain("recovery-access-token");
    expect(window.history.replaceState).toHaveBeenCalledWith(null, "King's Press", "/");
    expect(calls.map((call) => call.url)).toEqual([
      "/api/auth/config",
      "/api/auth/session",
      "https://example.supabase.co/auth/v1/user",
      "/api/auth/session",
    ]);
  });
});
