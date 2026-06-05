/**
 * Tests for the Hedra client. Run with vitest. These mock global.fetch so no
 * real network/secret is needed and assert: (1) the X-API-Key header is sent,
 * (2) the key never appears in thrown error messages, (3) status codes map to
 * safe error codes, (4) query params serialize correctly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as hedra from "../lib/hedra";

const KEY = "hedra_secret_should_never_leak";

function mockFetch(status: number, body: unknown, capture?: (url: string, init: RequestInit) => void) {
  return vi.fn(async (url: any, init: any) => {
    capture?.(String(url), init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  });
}

beforeEach(() => { process.env.HEDRA_API_KEY = KEY; });
afterEach(() => { vi.restoreAllMocks(); });

describe("hedra client", () => {
  it("sends the X-API-Key header and base URL", async () => {
    let seenUrl = "", seenHeaders: any = {};
    global.fetch = mockFetch(200, [{ id: "m1", type: "image" }], (u, i) => { seenUrl = u; seenHeaders = i.headers; }) as any;
    const models = await hedra.listModels(["image"]);
    expect(seenUrl).toContain("https://api.hedra.com/web-app/public/models");
    expect(seenUrl).toContain("type=image");
    expect((seenHeaders as Record<string, string>)["X-API-Key"]).toBe(KEY);
    expect(models[0].id).toBe("m1");
  });

  it("throws config error without leaking when key missing", async () => {
    delete process.env.HEDRA_API_KEY;
    await expect(hedra.getCredits()).rejects.toMatchObject({ code: "config" });
  });

  it("maps 401 to a safe auth error that does not contain the key", async () => {
    global.fetch = mockFetch(401, { message: "bad" }) as any;
    try {
      await hedra.getCredits();
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e).toBeInstanceOf(hedra.HedraError);
      expect(e.code).toBe("auth");
      expect(e.message).not.toContain(KEY);
    }
  });

  it("maps 402 to insufficient_credits and 429 to rate_limit", async () => {
    global.fetch = mockFetch(402, {}) as any;
    await expect(hedra.generateAsset({ type: "image", modelId: "m1" })).rejects.toMatchObject({ code: "insufficient_credits" });
    global.fetch = mockFetch(429, {}) as any;
    await expect(hedra.generateAsset({ type: "image", modelId: "m1" })).rejects.toMatchObject({ code: "rate_limit" });
  });

  it("getGenerationStatus hits the status path", async () => {
    let seenUrl = "";
    global.fetch = mockFetch(200, { id: "g1", status: "processing", progress: 40 }, (u) => { seenUrl = u; }) as any;
    const s = await hedra.getGenerationStatus("g1");
    expect(seenUrl).toContain("/generations/g1/status");
    expect(s.status).toBe("processing");
  });
});
