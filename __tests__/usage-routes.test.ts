import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("usage reservations in hosted routes", () => {
  it("reserves and completes usage around desk chat LLM calls", async () => {
    const reserveUsage = vi.fn(async () => ({ id: "usage_1", workspaceId: "workspace_1", idempotencyKey: "k" }));
    const completeUsageReservation = vi.fn();
    const failUsageReservation = vi.fn();
    const complete = vi.fn(async () => "Short reply.");

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/llm", () => ({
      getAIForTaskForUser: vi.fn(async () => ({
        ai: { complete },
        providerSource: "managed",
        provider: "openai",
        model: "gpt-4o-mini",
        profileId: null,
      })),
    }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveUsage,
      completeUsageReservation,
      failUsageReservation,
    }));

    const { POST } = await import("../app/api/desk/chat/route");
    const res = await POST(new Request("http://test.local/api/desk/chat", {
      method: "POST",
      body: JSON.stringify({
        mode: "desk",
        messages: [{ role: "user", content: "What should I write first?" }],
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ text: "Short reply." });
    expect(reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "chat",
      feature: "desk.chat.desk",
      campaignId: undefined,
      providerSource: "managed",
      provider: "openai",
      model: "gpt-4o-mini",
    }));
    expect(completeUsageReservation).toHaveBeenCalledWith(
      { id: "usage_1", workspaceId: "workspace_1", idempotencyKey: "k" },
      expect.objectContaining({ actualCredits: 1 }),
    );
    expect(failUsageReservation).not.toHaveBeenCalled();
  });

  it("does not reserve usage for local text extraction", async () => {
    const reserveUsage = vi.fn();
    const completeUsageReservation = vi.fn();
    const failUsageReservation = vi.fn();
    const extractFileText = vi.fn(async () => "plain text");
    const form = new FormData();
    form.set("file", new File([new Blob(["hello"])], "notes.txt", { type: "text/plain" }));

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/ai/fileExtract", () => ({ extractFileText }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveUsage,
      completeUsageReservation,
      failUsageReservation,
    }));

    const { POST } = await import("../app/api/extract/route");
    const res = await POST(new Request("http://test.local/api/extract", {
      method: "POST",
      body: form,
    }));

    expect(res.status).toBe(200);
    expect(reserveUsage).not.toHaveBeenCalled();
    expect(completeUsageReservation).toHaveBeenCalledWith(null);
    expect(failUsageReservation).not.toHaveBeenCalled();
  });

  it("marks hosted utility LLM usage as BYOK when a saved provider profile is used", async () => {
    const reservation = { id: "usage_1", workspaceId: "workspace_1", idempotencyKey: "k" };
    const reserveUsage = vi.fn(async () => reservation);
    const completeUsageReservation = vi.fn();
    const failUsageReservation = vi.fn();
    const complete = vi.fn(async () => "OK");

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/llm", () => ({
      getAIForTaskForUser: vi.fn(async () => ({
        ai: { complete },
        providerSource: "byok",
        provider: "openai",
        model: "gpt-4o-mini",
        profileId: "openai-gpt",
      })),
    }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveUsage,
      completeUsageReservation,
      failUsageReservation,
    }));

    const { POST } = await import("../app/api/llm/util/route");
    const res = await POST(new Request("http://test.local/api/llm/util", {
      method: "POST",
      body: JSON.stringify({ prompt: "Say OK.", task: "utility" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ text: "OK" });
    expect(reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "utility",
      feature: "llm.util.utility",
      providerSource: "byok",
      provider: "openai",
      model: "gpt-4o-mini",
      metadata: { profileId: "openai-gpt" },
    }));
    expect(completeUsageReservation).toHaveBeenCalledWith(reservation, expect.objectContaining({ actualCredits: 1 }));
    expect(failUsageReservation).not.toHaveBeenCalled();
  });

  it("reserves usage for model-backed image extraction", async () => {
    const reservation = { id: "usage_1", workspaceId: "workspace_1", idempotencyKey: "k" };
    const reserveUsage = vi.fn(async () => reservation);
    const completeUsageReservation = vi.fn();
    const failUsageReservation = vi.fn();
    const extractFileText = vi.fn(async () => "image notes");
    const form = new FormData();
    form.set("file", new File([new Blob(["fake image"])], "screen.png", { type: "image/png" }));

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/ai/fileExtract", () => ({ extractFileText }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveUsage,
      completeUsageReservation,
      failUsageReservation,
    }));

    const { POST } = await import("../app/api/extract/route");
    const res = await POST(new Request("http://test.local/api/extract", {
      method: "POST",
      body: form,
    }));

    expect(res.status).toBe(200);
    expect(reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "file_extract",
      feature: "file.extract",
    }));
    expect(completeUsageReservation).toHaveBeenCalledWith(reservation);
    expect(failUsageReservation).not.toHaveBeenCalled();
  });
});
