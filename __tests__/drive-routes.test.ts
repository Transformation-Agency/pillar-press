import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

function mockSettingsRow(row: unknown) {
  const limit = vi.fn(async () => (row ? [row] : []));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select, from, where, limit };
}

describe("Drive status route", () => {
  it("reports local desktop exports without exposing hosted Drive state", async () => {
    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "local-user", workspaceId: "local-workspace", role: "author" })),
      getOrCreateWorkspace: vi.fn(),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/local/database", () => ({
      getOrCreateLocalSettings: vi.fn(() => ({ driveFolderId: "local-folder" })),
    }));
    vi.doMock("@/lib/billing/entitlements", () => ({
      driveAccessForUser: vi.fn(async () => ({ enabled: false })),
    }));
    vi.doMock("@/lib/drive", async () => {
      const actual = await vi.importActual<any>("@/lib/drive");
      return { ...actual, folderName: vi.fn() };
    });

    const { GET } = await import("../app/api/drive/status/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      linked: false,
      folderId: "local-folder",
      folderName: "Local exports",
      localExportAvailable: true,
    });
    expect(JSON.stringify(body)).not.toContain("refresh");
  });

  it("reports hosted Drive folder status when Drive is entitled and linked", async () => {
    const dbChain = mockSettingsRow({
      driveRefreshToken: "refresh_secret_should_not_return",
      driveFolderId: "folder_123",
    });
    const folderName = vi.fn(async () => "Editorial exports");
    const driveAccessForUser = vi.fn(async () => ({ enabled: true }));

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
      getOrCreateWorkspace: vi.fn(),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/billing/entitlements", () => ({ driveAccessForUser }));
    vi.doMock("@/lib/drive", async () => {
      const actual = await vi.importActual<any>("@/lib/drive");
      return { ...actual, folderName };
    });
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { select: dbChain.select } };
    });

    const { GET } = await import("../app/api/drive/status/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      linked: true,
      folderId: "folder_123",
      folderName: "Editorial exports",
      driveEnabled: true,
    });
    expect(driveAccessForUser).toHaveBeenCalledWith({
      id: "user_1",
      workspaceId: "workspace_1",
      role: "author",
    });
    expect(folderName).toHaveBeenCalledWith("refresh_secret_should_not_return", "folder_123");
    expect(JSON.stringify(body)).not.toContain("refresh_secret_should_not_return");
  });
});

describe("Drive upload routes", () => {
  it("uploads prebuilt hosted output files to the linked Drive folder after entitlement", async () => {
    const dbChain = mockSettingsRow({
      driveRefreshToken: "refresh_secret",
      driveFolderId: "folder_123",
    });
    const requireDriveEnabled = vi.fn(async () => undefined);
    const uploadMany = vi.fn(async () => [{
      id: "drive_file_1",
      name: "draft.md",
      webViewLink: "https://drive.test/draft",
    }]);

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
      getOrCreateWorkspace: vi.fn(),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireDriveEnabled }));
    vi.doMock("@/lib/drive", async () => {
      const actual = await vi.importActual<any>("@/lib/drive");
      return { ...actual, uploadMany };
    });
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { select: dbChain.select } };
    });

    const { POST } = await import("../app/api/drive/upload/route");
    const res = await POST(new Request("https://pillarpress.test/api/drive/upload", {
      method: "POST",
      body: JSON.stringify({
        files: [{ name: "draft.md", content: "# Draft", mime: "text/markdown" }],
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.files).toEqual([{
      id: "drive_file_1",
      name: "draft.md",
      webViewLink: "https://drive.test/draft",
    }]);
    expect(requireDriveEnabled).toHaveBeenCalledWith({
      id: "user_1",
      workspaceId: "workspace_1",
      role: "author",
    });
    expect(uploadMany).toHaveBeenCalledWith(
      "refresh_secret",
      "folder_123",
      [{ name: "draft.md", content: "# Draft", mime: "text/markdown" }],
    );
    expect(JSON.stringify(body)).not.toContain("refresh_secret");
  });

  it("stores prebuilt output files as local exports in desktop mode", async () => {
    const requireDriveEnabled = vi.fn();
    const uploadMany = vi.fn();
    const writeLocalPublicFile = vi.fn(() => "/api/local-files/exports/draft.md");

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "local-user", workspaceId: "local-workspace", role: "author" })),
      getOrCreateWorkspace: vi.fn(),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/local/storage", () => ({ writeLocalPublicFile }));
    vi.doMock("@/lib/local/database", () => ({ getLocalPiece: vi.fn() }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireDriveEnabled }));
    vi.doMock("@/lib/drive", async () => {
      const actual = await vi.importActual<any>("@/lib/drive");
      return { ...actual, uploadMany };
    });

    const { POST } = await import("../app/api/drive/upload/route");
    const res = await POST(new Request("https://pillarpress.test/api/drive/upload", {
      method: "POST",
      body: JSON.stringify({
        files: [{ name: "draft.md", content: "# Draft", mime: "text/markdown" }],
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({
      files: [{
        id: "/api/local-files/exports/draft.md",
        name: "draft.md",
        webViewLink: "/api/local-files/exports/draft.md",
      }],
    });
    expect(writeLocalPublicFile).toHaveBeenCalledWith(
      Buffer.from("# Draft", "utf8"),
      "draft.md",
      "text/markdown",
      "exports",
    );
    expect(requireDriveEnabled).not.toHaveBeenCalled();
    expect(uploadMany).not.toHaveBeenCalled();
  });

  it("returns a local stored media file directly in desktop mode", async () => {
    const mediaId = "11111111-1111-4111-8111-111111111111";
    const uploadBinaryFile = vi.fn();
    const fetchSpy = vi.fn();

    vi.stubGlobal("fetch", fetchSpy);
    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "local-user", workspaceId: "local-workspace", role: "author" })),
      getOrCreateWorkspace: vi.fn(),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/local/database", () => ({
      getLocalMediaJob: vi.fn(() => ({
        id: mediaId,
        userId: "local-user",
        type: "image",
        prompt: "Cover art",
        modelName: "GPT Image",
        status: "completed",
        outputUrl: "/api/local-files/media/cover.png",
        downloadUrl: null,
      })),
    }));
    vi.doMock("@/lib/local/storage", () => ({
      isLocalStoredUrl: vi.fn((url: string) => url.startsWith("/api/local-files/")),
      writeLocalPublicFile: vi.fn(),
    }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireDriveEnabled: vi.fn() }));
    vi.doMock("@/lib/drive", async () => {
      const actual = await vi.importActual<any>("@/lib/drive");
      return { ...actual, uploadBinaryFile };
    });

    const { POST } = await import("../app/api/drive/upload-media/route");
    const res = await POST(new Request("https://pillarpress.test/api/drive/upload-media", {
      method: "POST",
      body: JSON.stringify({ mediaId }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({
      file: {
        id: "/api/local-files/media/cover.png",
        name: "Cover-art",
        webViewLink: "/api/local-files/media/cover.png",
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(uploadBinaryFile).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
