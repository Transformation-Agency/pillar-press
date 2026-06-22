import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
const craftImagePrompt = vi.fn(async () => "A quiet editorial cover image prompt.");
const craftVoiceScript = vi.fn(async () => "This is a clean voiceover script.");
const reserveUsage = vi.fn(async () => ({ id: "usage_1" }));
const completeUsageReservation = vi.fn(async () => undefined);
const failUsageReservation = vi.fn(async () => undefined);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), "kings-press-media-helpers-"));
  process.env.KINGS_PRESS_DATA_DIR = dir;
  process.env.KINGS_PRESS_LOCAL_FIRST = "true";

  vi.doMock("@/lib/auth", () => ({
    requireUser: vi.fn(async () => ({ id: "local-owner", workspaceId: "local-workspace", role: "author" })),
  }));
  vi.doMock("@/lib/llm", async () => {
    const actual = await vi.importActual<any>("@/lib/llm");
    return {
      ...actual,
      getAIForTaskForUser: vi.fn(async () => ({
        providerSource: "local",
        provider: "ollama",
        model: "gemma4:26b-mlx",
        profileId: "local-gemma",
        ai: { complete: vi.fn(), text: vi.fn() },
      })),
    };
  });
  vi.doMock("@/lib/ai/imagePrompt", () => ({ craftImagePrompt }));
  vi.doMock("@/lib/ai/voiceScript", () => ({ craftVoiceScript }));
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
  vi.doUnmock("@/lib/auth");
  vi.doUnmock("@/lib/llm");
  vi.doUnmock("@/lib/ai/imagePrompt");
  vi.doUnmock("@/lib/ai/voiceScript");
  vi.doUnmock("@/lib/billing/usage");
  rmSync(dir, { recursive: true, force: true });
});

describe("Studio prompt and script helper routes", () => {
  it("builds an art-directed image prompt from campaign, style, and linked piece context", async () => {
    const {
      createLocalCampaign,
      createLocalPiece,
      updateLocalReferences,
      upsertLocalStyleProfile,
    } = await import("@/lib/local/database");
    const campaign = createLocalCampaign({ name: "Media helpers" });
    updateLocalReferences(campaign.id, {
      patch: { strategy: { body: "Use practical, grounded editorial framing." } },
    });
    upsertLocalStyleProfile({
      campaignId: campaign.id,
      userId: "local-owner",
      knobs: { palette: "muted", mood: "bright", finish: "photographic", detail: "balanced" },
      directive: "Muted editorial photography with generous negative space.",
      rounds: 2,
    });
    const piece = createLocalPiece({
      campaignId: campaign.id,
      userId: "local-owner",
      title: "The local-first desk",
      original: "This piece argues that local software should feel calm, sturdy, and humane.",
    });

    const { POST } = await import("../app/api/hedra/prompt/route");
    const res = await POST(new Request("http://test.local/api/hedra/prompt", {
      method: "POST",
      body: JSON.stringify({
        prompt: "Show a calm writing desk.",
        campaignId: campaign.id,
        pieceId: piece!.id,
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ prompt: "A quiet editorial cover image prompt." });
    expect(craftImagePrompt).toHaveBeenCalledWith(expect.objectContaining({
      seed: "Show a calm writing desk.",
      styleDirective: "Muted editorial photography with generous negative space.",
      article: {
        title: "The local-first desk",
        excerpt: expect.stringContaining("local software should feel calm"),
      },
    }), expect.objectContaining({ complete: expect.any(Function) }));
    const imageCall = craftImagePrompt.mock.calls[0] as unknown as [{ refContext?: string }, unknown];
    expect(String(imageCall[0].refContext)).toContain("practical, grounded editorial framing");
    expect(reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "utility",
      feature: "hedra.prompt",
      campaignId: campaign.id,
      pieceId: piece!.id,
      providerSource: "local",
      provider: "ollama",
      model: "gemma4:26b-mlx",
      metadata: { profileId: "local-gemma" },
    }));
    expect(completeUsageReservation).toHaveBeenCalledWith({ id: "usage_1" });
    expect(failUsageReservation).not.toHaveBeenCalled();
  });

  it("builds an ElevenLabs-ready voice script from the linked piece and campaign context", async () => {
    const {
      createLocalCampaign,
      createLocalPiece,
      updateLocalPiece,
      updateLocalReferences,
    } = await import("@/lib/local/database");
    const campaign = createLocalCampaign({ name: "Voice helpers" });
    updateLocalReferences(campaign.id, {
      patch: { strategy: { body: "Plainspoken, warm, no hype." } },
    });
    const piece = createLocalPiece({
      campaignId: campaign.id,
      userId: "local-owner",
      title: "A spoken editorial note",
      original: "Use this if no revision exists.",
    });
    updateLocalPiece(piece!.id, "local-owner", {
      revision: { text: "Read the revised version aloud. Keep it natural for the ear.", changelog: [] },
    });

    const { POST } = await import("../app/api/hedra/voice-script/route");
    const res = await POST(new Request("http://test.local/api/hedra/voice-script", {
      method: "POST",
      body: JSON.stringify({
        pieceId: piece!.id,
        campaignId: campaign.id,
        voiceName: "Narrator",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ script: "This is a clean voiceover script." });
    expect(craftVoiceScript).toHaveBeenCalledWith(expect.objectContaining({
      article: {
        title: "A spoken editorial note",
        text: "Read the revised version aloud. Keep it natural for the ear.",
      },
      voiceName: "Narrator",
    }), expect.objectContaining({ text: expect.any(Function) }));
    const voiceCall = craftVoiceScript.mock.calls[0] as unknown as [{ refContext?: string }, unknown];
    expect(String(voiceCall[0].refContext)).toContain("Plainspoken, warm, no hype.");
    expect(reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "utility",
      feature: "hedra.voice_script",
      campaignId: campaign.id,
      pieceId: piece!.id,
      providerSource: "local",
      provider: "ollama",
      model: "gemma4:26b-mlx",
      metadata: { profileId: "local-gemma" },
    }));
    expect(completeUsageReservation).toHaveBeenCalledWith({ id: "usage_1" });
    expect(failUsageReservation).not.toHaveBeenCalled();
  });
});
