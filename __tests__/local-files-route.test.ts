import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let storageDir: string;
let requireUser: ReturnType<typeof vi.fn>;
let isLocalFirstMode: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  storageDir = join(tmpdir(), `kings-press-local-files-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(storageDir, "media"), { recursive: true });
  requireUser = vi.fn(async () => ({ id: "local-owner", workspaceId: "local-workspace", role: "author" }));
  isLocalFirstMode = vi.fn(() => true);
  vi.doMock("@/lib/auth", () => ({ requireUser }));
  vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode }));
  vi.doMock("@/lib/local/paths", () => ({ localStorageDir: () => storageDir }));
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  rmSync(storageDir, { recursive: true, force: true });
});

async function getLocalFile(path: string[]) {
  const { GET } = await import("../app/api/local-files/[...path]/route");
  return GET(new Request("https://kingspress.test/api/local-files/media/example.txt?contentType=text/plain"), {
    params: Promise.resolve({ path }),
  });
}

describe("local file route", () => {
  it("serves authenticated local-first files without exposing arbitrary paths", async () => {
    writeFileSync(join(storageDir, "media", "example.txt"), "hello");

    const res = await getLocalFile(["media", "example.txt"]);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(body).toBe("hello");
    expect(requireUser).toHaveBeenCalledOnce();
  });

  it("rejects local-file reads outside local-first mode", async () => {
    isLocalFirstMode.mockReturnValue(false);
    writeFileSync(join(storageDir, "media", "example.txt"), "hello");

    const res = await getLocalFile(["media", "example.txt"]);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Not found.", code: "not_found" });
  });

  it("requires an authenticated desktop/local session", async () => {
    const error = new Error("Unauthorized");
    Object.assign(error, { status: 401, code: "unauthorized" });
    requireUser.mockRejectedValue(error);

    const res = await getLocalFile(["media", "example.txt"]);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized.", code: "unauthorized" });
  });
});
