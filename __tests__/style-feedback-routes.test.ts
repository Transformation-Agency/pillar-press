import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
const complete = vi.fn(async () => "{\"directive\":\"Use cool editorial photography, soft window light, precise negative space, and restrained detail.\"}");
const reserveUsage = vi.fn(async () => ({ id: "usage_1" }));
const completeUsageReservation = vi.fn(async () => undefined);
const failUsageReservation = vi.fn(async () => undefined);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), "kings-press-style-feedback-"));
  process.env.KINGS_PRESS_DATA_DIR = dir;
  process.env.KINGS_PRESS_LOCAL_FIRST = "true";
  delete process.env.DEFAULT_USER_ID;

  vi.doMock("@/lib/llm", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/llm")>();
    return {
      ...actual,
      getAIForTaskForUser: vi.fn(async () => ({
        providerSource: "local",
        provider: "ollama",
        model: "gemma4:26b-mlx",
        profileId: "local-gemma",
        ai: { complete },
      })),
    };
  });
  vi.doMock("@/lib/billing/usage", () => ({
    reserveUsage,
    completeUsageReservation,
    failUsageReservation,
  }));
});

afterEach(async () => {
  const { resetLocalDbForTests } = await import("@/lib/local/database");
  resetLocalDbForTests();
  delete process.env.KINGS_PRESS_DATA_DIR;
  delete process.env.KINGS_PRESS_LOCAL_FIRST;
  delete process.env.DEFAULT_USER_ID;
  vi.doUnmock("@/lib/llm");
  vi.doUnmock("@/lib/billing/usage");
  rmSync(dir, { recursive: true, force: true });
});

describe("style feedback routes", () => {
  it("returns default style settings for a campaign with no learned profile", async () => {
    const { createLocalCampaign } = await import("@/lib/local/database");
    const campaign = createLocalCampaign({ name: "Visual style defaults" });

    const { GET } = await import("../app/api/campaigns/[id]/style/route");
    const res = await GET(new Request("http://test.local/api/campaigns/" + campaign.id + "/style"), {
      params: Promise.resolve({ id: campaign.id }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      knobs: { palette: "warm", mood: "neutral", finish: "photographic", detail: "balanced" },
      directive: "",
      rounds: 0,
    });
  });

  it("saves style survey feedback, normalizes knobs, increments rounds, and records utility usage", async () => {
    const {
      createLocalCampaign,
      listLocalStyleFeedback,
      updateLocalReferences,
    } = await import("@/lib/local/database");
    const campaign = createLocalCampaign({ name: "Visual style survey" });
    updateLocalReferences(campaign.id, {
      patch: { strategy: { body: "Prefer calm editorial visuals for thoughtful essays." } },
    });
    const mediaJobId = randomUUID();

    const feedbackRoute = await import("../app/api/campaigns/[id]/style/feedback/route");
    const first = await feedbackRoute.POST(new Request("http://test.local/api/campaigns/" + campaign.id + "/style/feedback", {
      method: "POST",
      body: JSON.stringify({
        rating: 5,
        knobs: { palette: "cool", mood: "not-a-mood", finish: "photographic", detail: "minimal" },
        working: "The quiet palette and negative space fit.",
        notes: "Keep faces out of frame.",
        mediaJobId,
      }),
    }), { params: Promise.resolve({ id: campaign.id }) });
    const firstBody = await first.json();

    expect(first.status).toBe(200);
    expect(firstBody).toEqual({
      knobs: { palette: "cool", mood: "neutral", finish: "photographic", detail: "minimal" },
      directive: "Use cool editorial photography, soft window light, precise negative space, and restrained detail.",
      rounds: 1,
    });
    expect(complete).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({
        content: expect.stringContaining("palette=cool, mood=neutral, finish=photographic, detail=minimal"),
      })]),
      expect.stringContaining("Prefer calm editorial visuals for thoughtful essays."),
    );
    expect(reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "utility",
      feature: "style.feedback",
      campaignId: campaign.id,
      providerSource: "local",
      provider: "ollama",
      model: "gemma4:26b-mlx",
      metadata: { profileId: "local-gemma" },
      estimatedCredits: 1,
    }));
    expect(completeUsageReservation).toHaveBeenCalledWith({ id: "usage_1" });
    expect(failUsageReservation).not.toHaveBeenCalled();

    const feedback = listLocalStyleFeedback(campaign.id);
    expect(feedback).toHaveLength(1);
    expect(feedback?.[0]).toMatchObject({
      campaignId: campaign.id,
      mediaJobId,
      rating: 5,
      knobs: { palette: "cool", mood: "neutral", finish: "photographic", detail: "minimal" },
      working: "The quiet palette and negative space fit.",
      notes: "Keep faces out of frame.",
    });

    complete.mockResolvedValueOnce("{\"directive\":\"Keep the cool palette, add a little more atmosphere, and preserve negative space.\"}");
    const second = await feedbackRoute.POST(new Request("http://test.local/api/campaigns/" + campaign.id + "/style/feedback", {
      method: "POST",
      body: JSON.stringify({
        rating: 4,
        knobs: { palette: "muted", mood: "moody", finish: "painterly", detail: "balanced" },
        working: "The composition is closer.",
        notes: "Make light softer.",
      }),
    }), { params: Promise.resolve({ id: campaign.id }) });
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(secondBody).toMatchObject({
      knobs: { palette: "muted", mood: "moody", finish: "painterly", detail: "balanced" },
      directive: "Keep the cool palette, add a little more atmosphere, and preserve negative space.",
      rounds: 2,
    });
    expect(listLocalStyleFeedback(campaign.id)).toHaveLength(2);
  });

  it("returns 404 for out-of-scope campaigns without reserving usage", async () => {
    const { POST } = await import("../app/api/campaigns/[id]/style/feedback/route");
    const res = await POST(new Request("http://test.local/api/campaigns/missing/style/feedback", {
      method: "POST",
      body: JSON.stringify({
        rating: 4,
        knobs: { palette: "warm", mood: "neutral", finish: "photographic", detail: "balanced" },
      }),
    }), { params: Promise.resolve({ id: "missing" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toMatchObject({ code: "not_found" });
    expect(reserveUsage).not.toHaveBeenCalled();
    expect(completeUsageReservation).not.toHaveBeenCalled();
    expect(failUsageReservation).not.toHaveBeenCalled();
  });
});
