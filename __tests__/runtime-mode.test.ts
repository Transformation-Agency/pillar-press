import { afterEach, describe, expect, it } from "vitest";
import { isHostedWebMode, isLocalFirstMode } from "@/lib/local/mode";
import { localStorageConfigured } from "@/lib/local/storage";

const touched = [
  "PILLAR_PRESS_RUNTIME",
  "PILLAR_PRESS_HOSTED_WEB",
  "PILLAR_PRESS_LOCAL_FIRST",
  "DATA_BACKEND",
  "PILLAR_PRESS_DB_PATH",
  "STORAGE_PROVIDER",
  "PILLAR_PRESS_STORAGE",
  "SUPABASE_URL",
] as const;

afterEach(() => {
  for (const key of touched) delete process.env[key];
});

describe("runtime mode", () => {
  it("uses local-first mode for packaged desktop settings", () => {
    expect(isLocalFirstMode({
      PILLAR_PRESS_LOCAL_FIRST: "true",
      DATA_BACKEND: "sqlite",
    })).toBe(true);
  });

  it("lets hosted web mode override stale local-first flags", () => {
    const env = {
      PILLAR_PRESS_RUNTIME: "hosted",
      PILLAR_PRESS_LOCAL_FIRST: "true",
      DATA_BACKEND: "sqlite",
      PILLAR_PRESS_DB_PATH: "/tmp/pillar-press.sqlite3",
    };
    expect(isHostedWebMode(env)).toBe(true);
    expect(isLocalFirstMode(env)).toBe(false);
  });

  it("treats postgres backend as hosted web", () => {
    expect(isHostedWebMode({ DATA_BACKEND: "postgres" })).toBe(true);
    expect(isLocalFirstMode({ DATA_BACKEND: "postgres", PILLAR_PRESS_LOCAL_FIRST: "true" })).toBe(false);
  });

  it("does not fall back to local file storage in hosted web mode", () => {
    process.env.PILLAR_PRESS_RUNTIME = "hosted";
    process.env.PILLAR_PRESS_LOCAL_FIRST = "true";
    process.env.STORAGE_PROVIDER = "local";
    process.env.PILLAR_PRESS_STORAGE = "local";
    delete process.env.SUPABASE_URL;

    expect(localStorageConfigured()).toBe(false);
  });

  it("allows local file storage in local-first mode", () => {
    process.env.PILLAR_PRESS_LOCAL_FIRST = "true";
    process.env.STORAGE_PROVIDER = "local";

    expect(localStorageConfigured()).toBe(true);
  });
});
