import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
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
    vi.doMock("@/lib/local/mode", () => ({
      isLocalFirstMode: () => false,
    }));
    vi.doMock("@/lib/auth", () => ({
      getCurrentUser: vi.fn(async () => ({ id: "user_1" })),
      getOrCreateWorkspace,
      isAuthDisabled: () => false,
    }));

    const { GET } = await import("../app/api/auth/session/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(getOrCreateWorkspace).toHaveBeenCalledWith("user_1");
    expect(body).toEqual({
      authenticated: true,
      authDisabled: false,
      user: {
        id: "user_1",
        workspaceId: "workspace_1",
        role: "author",
      },
    });
  });

  it("returns 401 without a hosted user session", async () => {
    vi.doMock("@/lib/local/mode", () => ({
      isLocalFirstMode: () => false,
    }));
    vi.doMock("@/lib/auth", () => ({
      getCurrentUser: vi.fn(async () => null),
      getOrCreateWorkspace: vi.fn(),
      isAuthDisabled: () => false,
    }));

    const { GET } = await import("../app/api/auth/session/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ authenticated: false, user: null });
  });
});
