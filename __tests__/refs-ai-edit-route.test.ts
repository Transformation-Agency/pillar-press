import { beforeEach, describe, expect, it, vi } from "vitest";

const assertAuthor = vi.fn();
const getLocalCampaign = vi.fn();
const getLocalReferences = vi.fn();
const craftReferencesEdit = vi.fn();
const getAIForTaskForUser = vi.fn();
const reserveUsage = vi.fn();
const completeUsageReservation = vi.fn();
const failUsageReservation = vi.fn();

vi.mock("@/lib/auth", () => ({ assertAuthor }));
vi.mock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
vi.mock("@/lib/local/database", () => ({
  getLocalCampaign,
  getLocalReferences,
}));
vi.mock("@/lib/ai/refsEdit", () => ({ craftReferencesEdit }));
vi.mock("@/lib/llm", async () => {
  const actual = await vi.importActual<any>("@/lib/llm");
  return { ...actual, getAIForTaskForUser };
});
vi.mock("@/lib/billing/usage", () => ({
  reserveUsage,
  completeUsageReservation,
  failUsageReservation,
}));
vi.mock("@/lib/db", () => ({
  db: { query: { campaigns: { findFirst: vi.fn() }, references: { findFirst: vi.fn() } } },
  campaigns: {},
  references: {},
}));

const params = { params: Promise.resolve({ id: "campaign_1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  assertAuthor.mockResolvedValue({ id: "local_user", workspaceId: "local_workspace", role: "author" });
  getLocalCampaign.mockReturnValue({ id: "campaign_1", workspaceId: "local_workspace" });
  getLocalReferences.mockReturnValue({
    doc: {
      strategy: { throughlines: [], body: "Strategy" },
      audiences: { list: [] },
      registers: { list: [], body: "" },
      voiceRules: { rules: [] },
      redLines: { rules: [] },
      selfVision: { body: "" },
      gateSpec: { body: "" },
    },
  });
  getAIForTaskForUser.mockResolvedValue({
    ai: { text: vi.fn() },
    providerSource: "managed",
    provider: "ollama",
    model: "gemma4:26b-mlx",
    profileId: null,
  });
  reserveUsage.mockResolvedValue({ id: "reservation_1" });
  completeUsageReservation.mockResolvedValue(undefined);
  failUsageReservation.mockResolvedValue(undefined);
  craftReferencesEdit.mockResolvedValue({
    ok: true,
    doc: { strategy: { throughlines: [], body: "Updated strategy" } },
    summary: "Updated strategy.",
  });
});

describe("references AI edit route", () => {
  it("returns a proposed preferences document without persisting it", async () => {
    const { POST } = await import("../app/api/campaigns/[id]/references/ai-edit/route");
    const res = await POST(new Request("http://test.local/api/campaigns/campaign_1/references/ai-edit", {
      method: "POST",
      body: JSON.stringify({ instruction: "Make the strategy sharper." }),
    }), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      doc: { strategy: { throughlines: [], body: "Updated strategy" } },
      summary: "Updated strategy.",
    });
    expect(craftReferencesEdit).toHaveBeenCalledWith({
      doc: getLocalReferences.mock.results[0].value.doc,
      instruction: "Make the strategy sharper.",
    }, expect.any(Object));
    expect(reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "utility",
      feature: "references.ai_edit",
      campaignId: "campaign_1",
      provider: "ollama",
      model: "gemma4:26b-mlx",
    }));
    expect(completeUsageReservation).toHaveBeenCalledWith({ id: "reservation_1" });
    expect(failUsageReservation).not.toHaveBeenCalled();
  });

  it("reports invalid AI edits without completing usage", async () => {
    craftReferencesEdit.mockResolvedValueOnce({ ok: false, doc: {}, summary: "No usable edit." });

    const { POST } = await import("../app/api/campaigns/[id]/references/ai-edit/route");
    const res = await POST(new Request("http://test.local/api/campaigns/campaign_1/references/ai-edit", {
      method: "POST",
      body: JSON.stringify({ instruction: "Change everything." }),
    }), params);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body).toEqual({
      error: "The AI couldn't produce a valid edit. Try rephrasing your instruction.",
      code: "ai_parse",
    });
    expect(failUsageReservation).toHaveBeenCalledWith({ id: "reservation_1" }, expect.any(Error));
    expect(completeUsageReservation).not.toHaveBeenCalled();
  });

  it("requires an author before creating AI edits", async () => {
    const err = new Error("Forbidden.");
    Object.assign(err, { status: 403, code: "forbidden" });
    assertAuthor.mockRejectedValueOnce(err);

    const { POST } = await import("../app/api/campaigns/[id]/references/ai-edit/route");
    const res = await POST(new Request("http://test.local/api/campaigns/campaign_1/references/ai-edit", {
      method: "POST",
      body: JSON.stringify({ instruction: "Add a red line." }),
    }), params);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: "Forbidden.", code: "forbidden" });
    expect(craftReferencesEdit).not.toHaveBeenCalled();
    expect(reserveUsage).not.toHaveBeenCalled();
  });
});
