import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hosted auth mode defaults", () => {
  it("keeps local web/dev skip-login compatibility when AUTH_DISABLED is omitted", async () => {
    const { isAuthDisabled } = await import("@/lib/auth");

    expect(isAuthDisabled()).toBe(true);
  });

  it("requires account auth by default in hosted mode when AUTH_DISABLED is omitted", async () => {
    vi.stubEnv("KINGS_PRESS_RUNTIME", "hosted");

    const { isAuthDisabled } = await import("@/lib/auth");

    expect(isAuthDisabled()).toBe(false);
  });

  it("allows explicit hosted private-preview skip-login mode", async () => {
    vi.stubEnv("KINGS_PRESS_RUNTIME", "hosted");
    vi.stubEnv("AUTH_DISABLED", "true");

    const { isAuthDisabled } = await import("@/lib/auth");

    expect(isAuthDisabled()).toBe(true);
  });

  it("keeps explicit AUTH_DISABLED=false strict in all runtimes", async () => {
    vi.stubEnv("AUTH_DISABLED", "false");

    const { isAuthDisabled } = await import("@/lib/auth");

    expect(isAuthDisabled()).toBe(false);
  });
});

describe("hosted auth API contract", () => {
  it("returns only public Supabase config when hosted auth is required", async () => {
    vi.doMock("@/lib/local/mode", () => ({
      isHostedWebMode: () => true,
      isLocalFirstMode: () => false,
    }));
    vi.doMock("@/lib/auth", () => ({
      isAuthDisabled: () => false,
    }));
    vi.doMock("@/lib/supabase", () => ({
      publicSupabaseUrl: () => "https://example.supabase.co",
      supabaseAnonKey: () => "anon-public-key",
    }));

    const { GET } = await import("../app/api/auth/config/route");
    const res = await GET();
    const body = await res.json();

    expect(body).toEqual({
      hosted: true,
      localFirst: false,
      authDisabled: false,
      requiresLogin: true,
      ready: true,
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-public-key",
    });
    expect(JSON.stringify(body)).not.toContain("service");
  });

  it("does not expose Supabase config when hosted auth is disabled", async () => {
    vi.doMock("@/lib/local/mode", () => ({
      isHostedWebMode: () => true,
      isLocalFirstMode: () => false,
    }));
    vi.doMock("@/lib/auth", () => ({
      isAuthDisabled: () => true,
    }));
    vi.doMock("@/lib/supabase", () => ({
      publicSupabaseUrl: () => "https://example.supabase.co",
      supabaseAnonKey: () => "anon-public-key",
    }));

    const { GET } = await import("../app/api/auth/config/route");
    const res = await GET();
    const body = await res.json();

    expect(body.requiresLogin).toBe(false);
    expect(body.supabaseUrl).toBeNull();
    expect(body.supabaseAnonKey).toBeNull();
  });

  it("bootstraps a workspace for an authenticated hosted user without membership", async () => {
    const getOrCreateWorkspace = vi.fn(async () => "workspace_1");
    const getOrCreateTrialSubscription = vi.fn(async () => ({
      id: "sub_trial_1",
      planId: "trial",
      status: "trialing",
      trialStart: new Date("2026-06-11T00:00:00.000Z"),
      trialEnd: new Date("2026-06-18T00:00:00.000Z"),
      currentPeriodEnd: null,
    }));
    vi.doMock("@/lib/local/mode", () => ({
      isHostedWebMode: () => true,
      isLocalFirstMode: () => false,
    }));
    vi.doMock("@/lib/auth", () => ({
      getCurrentUser: vi.fn(async () => ({ id: "user_1" })),
      getOrCreateWorkspace,
      isAuthDisabled: () => false,
    }));
    vi.doMock("@/lib/billing/stripe", () => ({
      getOrCreateTrialSubscription,
    }));

    const { GET } = await import("../app/api/auth/session/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(getOrCreateWorkspace).toHaveBeenCalledWith("user_1");
    expect(getOrCreateTrialSubscription).toHaveBeenCalledWith(
      { id: "user_1", workspaceId: "workspace_1" },
      "auth_session",
    );
    expect(body).toEqual({
      authenticated: true,
      authDisabled: false,
      user: {
        id: "user_1",
        workspaceId: "workspace_1",
        role: "author",
      },
      subscription: {
        id: "sub_trial_1",
        planId: "trial",
        status: "trialing",
        trialStart: "2026-06-11T00:00:00.000Z",
        trialEnd: "2026-06-18T00:00:00.000Z",
        currentPeriodEnd: null,
      },
    });
  });

  it("returns 401 without a hosted user session", async () => {
    vi.doMock("@/lib/local/mode", () => ({
      isHostedWebMode: () => true,
      isLocalFirstMode: () => false,
    }));
    vi.doMock("@/lib/auth", () => ({
      getCurrentUser: vi.fn(async () => null),
      getOrCreateWorkspace: vi.fn(),
      isAuthDisabled: () => false,
    }));
    vi.doMock("@/lib/billing/stripe", () => ({
      getOrCreateTrialSubscription: vi.fn(),
    }));

    const { GET } = await import("../app/api/auth/session/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ authenticated: false, user: null });
  });
});
