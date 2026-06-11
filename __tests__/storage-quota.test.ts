import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
});

describe("hosted public storage quota reservations", () => {
  it("reserves bytes before hosted upload and releases them when upload fails", async () => {
    const reservation = {
      workspaceId: "workspace_1",
      bytes: 4,
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
    };
    const reserveStorageBytes = vi.fn(async () => reservation);
    const releaseStorageReservation = vi.fn();

    process.env.SUPABASE_URL = "http://storage.test";
    process.env.SUPABASE_ANON_KEY = "anon";

    vi.doMock("@/lib/local/storage", () => ({
      isLocalStoredUrl: vi.fn(() => false),
      localStorageConfigured: vi.fn(() => false),
      writeLocalPublicFile: vi.fn(),
    }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveStorageBytes,
      releaseStorageReservation,
    }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));

    const { uploadPublicFile } = await import("@/lib/storage");

    await expect(uploadPublicFile(
      Buffer.from("test"),
      "example.png",
      "image/png",
      "image",
      { user: { id: "user_1", workspaceId: "workspace_1", role: "author" } },
    )).rejects.toThrow("Upload failed");

    expect(reserveStorageBytes).toHaveBeenCalledWith({
      user: { id: "user_1", workspaceId: "workspace_1", role: "author" },
      bytes: 4,
      feature: "storage.image",
    });
    expect(releaseStorageReservation).toHaveBeenCalledWith(reservation);
  });

  it("does not reserve hosted bytes for local-first storage", async () => {
    const reserveStorageBytes = vi.fn();
    const releaseStorageReservation = vi.fn();
    const writeLocalPublicFile = vi.fn(() => "/api/local-files/image/example.png");

    vi.doMock("@/lib/local/storage", () => ({
      isLocalStoredUrl: vi.fn(() => false),
      localStorageConfigured: vi.fn(() => true),
      writeLocalPublicFile,
    }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveStorageBytes,
      releaseStorageReservation,
    }));

    const { uploadPublicFile } = await import("@/lib/storage");
    const url = await uploadPublicFile(
      Buffer.from("test"),
      "example.png",
      "image/png",
      "image",
      { user: { id: "local_user", workspaceId: "local_workspace", role: "author" } },
    );

    expect(url).toBe("/api/local-files/image/example.png");
    expect(reserveStorageBytes).not.toHaveBeenCalled();
    expect(releaseStorageReservation).not.toHaveBeenCalled();
  });
});
