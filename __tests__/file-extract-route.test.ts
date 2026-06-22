import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

function mockRouteDeps(overrides: {
  extractFileText?: ReturnType<typeof vi.fn>;
  reserveUsage?: ReturnType<typeof vi.fn>;
  completeUsageReservation?: ReturnType<typeof vi.fn>;
  failUsageReservation?: ReturnType<typeof vi.fn>;
} = {}) {
  const extractFileText = overrides.extractFileText ?? vi.fn(async ({ bytes }: { bytes: Buffer }) => bytes.toString("utf8"));
  const reserveUsage = overrides.reserveUsage ?? vi.fn(async () => ({ id: "usage_1" }));
  const completeUsageReservation = overrides.completeUsageReservation ?? vi.fn(async () => undefined);
  const failUsageReservation = overrides.failUsageReservation ?? vi.fn(async () => undefined);

  vi.doMock("@/lib/auth", () => ({
    requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
  }));
  vi.doMock("@/lib/ai/fileExtract", () => ({ extractFileText }));
  vi.doMock("@/lib/billing/usage", () => ({
    reserveUsage,
    completeUsageReservation,
    failUsageReservation,
  }));

  return { extractFileText, reserveUsage, completeUsageReservation, failUsageReservation };
}

describe("file extraction route", () => {
  it("returns text from uploaded text-like files without reserving model usage", async () => {
    const deps = mockRouteDeps();
    const form = new FormData();
    form.set("file", new File(["Research notes"], "notes.md", { type: "text/markdown" }));

    const { POST } = await import("../app/api/extract/route");
    const res = await POST(new Request("http://test.local/api/extract", {
      method: "POST",
      body: form,
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ name: "notes.md", text: "Research notes" });
    expect(deps.extractFileText).toHaveBeenCalledWith(expect.objectContaining({
      name: "notes.md",
      mimeType: "text/markdown",
      bytes: expect.any(Buffer),
    }));
    expect(deps.reserveUsage).not.toHaveBeenCalled();
    expect(deps.completeUsageReservation).toHaveBeenCalledWith(null);
    expect(deps.failUsageReservation).not.toHaveBeenCalled();
  });

  it("rejects missing, empty, and oversized uploads before extraction", async () => {
    const deps = mockRouteDeps();
    const { POST } = await import("../app/api/extract/route");

    const missing = await POST(new Request("http://test.local/api/extract", {
      method: "POST",
      body: new FormData(),
    }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: "bad_request", error: "No file uploaded." });

    const emptyForm = new FormData();
    emptyForm.set("file", new File([""], "empty.txt", { type: "text/plain" }));
    const empty = await POST(new Request("http://test.local/api/extract", {
      method: "POST",
      body: emptyForm,
    }));
    expect(empty.status).toBe(422);
    expect(await empty.json()).toMatchObject({ code: "validation", error: "That file is empty." });

    const largeForm = new FormData();
    largeForm.set("file", new File([new Uint8Array(5 * 1024 * 1024)], "large.txt", { type: "text/plain" }));
    const large = await POST(new Request("http://test.local/api/extract", {
      method: "POST",
      body: largeForm,
    }));
    expect(large.status).toBe(413);
    expect(await large.json()).toMatchObject({ code: "too_large" });

    expect(deps.extractFileText).not.toHaveBeenCalled();
    expect(deps.reserveUsage).not.toHaveBeenCalled();
    expect(deps.completeUsageReservation).not.toHaveBeenCalled();
    expect(deps.failUsageReservation).not.toHaveBeenCalled();
  });

  it("fails a model-backed reservation when extraction returns no readable text", async () => {
    const reservation = { id: "usage_1" };
    const deps = mockRouteDeps({
      extractFileText: vi.fn(async () => "   "),
      reserveUsage: vi.fn(async () => reservation),
    });
    const form = new FormData();
    form.set("file", new File(["fake image"], "screen.png", { type: "image/png" }));

    const { POST } = await import("../app/api/extract/route");
    const res = await POST(new Request("http://test.local/api/extract", {
      method: "POST",
      body: form,
    }));
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body).toMatchObject({ code: "validation", error: "Couldn't read any text from that file." });
    expect(deps.reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "file_extract",
      feature: "file.extract",
      estimatedCredits: 1,
      metadata: { mimeType: "image/png", size: 10 },
    }));
    expect(deps.failUsageReservation).toHaveBeenCalledWith(reservation, expect.any(Error));
    expect(deps.completeUsageReservation).not.toHaveBeenCalled();
  });
});
