import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ORIGINAL_ENV = { ...process.env };
let tempDir: string | null = null;

describe("local-first auth identity", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "kp-local-auth-"));
    process.env = {
      ...ORIGINAL_ENV,
      DATA_BACKEND: "sqlite",
      PILLAR_PRESS_DB_PATH: join(tempDir, "pillar-press.sqlite3"),
      DEFAULT_USER_ID: "dev-user",
    };
    delete process.env.PILLAR_PRESS_LOCAL_USER_ID;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  it("uses the canonical local owner even when the dev fallback user is set", async () => {
    const { requireUser } = await import("@/lib/auth");

    await expect(requireUser()).resolves.toEqual({
      id: "local-owner",
      workspaceId: "local-workspace",
      role: "author",
    });
  });

  it("allows an explicit local-first owner override without using DEFAULT_USER_ID", async () => {
    process.env.PILLAR_PRESS_LOCAL_USER_ID = "import-owner";
    const { requireUser } = await import("@/lib/auth");

    await expect(requireUser()).resolves.toEqual({
      id: "import-owner",
      workspaceId: "local-workspace",
      role: "author",
    });
  });
});
