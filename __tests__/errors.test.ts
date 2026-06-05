import { describe, it, expect } from "vitest";
import { ZodError, z } from "zod";
import { toErrorResponse } from "@/lib/errors";

// Regression guard for the acceptance criteria: unauthenticated → 401,
// assistant on an author-only route → 403. The auth layer throws plain Errors
// tagged with a numeric .status; toErrorResponse must surface those 4xx codes
// (and must NOT collapse 403→401 the way provider key errors do).
function tagged(status: number, code?: string) {
  const e = new Error("auth");
  (e as { status?: number }).status = status;
  if (code) (e as { code?: string }).code = code;
  return e;
}

describe("toErrorResponse auth mapping", () => {
  it("maps a 401-tagged error to HTTP 401", () => {
    expect(toErrorResponse(tagged(401, "unauthorized")).status).toBe(401);
  });

  it("maps a 403-tagged error to HTTP 403 (not collapsed to 401)", () => {
    expect(toErrorResponse(tagged(403, "forbidden")).status).toBe(403);
  });

  it("maps a ZodError to HTTP 400", () => {
    let zerr: ZodError;
    try {
      z.object({ a: z.string() }).parse({});
      throw new Error("should have thrown");
    } catch (e) {
      zerr = e as ZodError;
    }
    expect(toErrorResponse(zerr!).status).toBe(400);
  });

  it("maps an untagged error to HTTP 500 (no detail leak)", async () => {
    const res = toErrorResponse(new Error("boom with secret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("internal");
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
