import { beforeEach, describe, expect, it, vi } from "vitest";

const completeMock = vi.fn();
const campaignFindMock = vi.fn();
const referencesFindMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
}));

vi.mock("@/lib/local/mode", () => ({
  isLocalFirstMode: vi.fn(() => false),
}));

vi.mock("@/lib/local/database", () => ({
  getLocalCampaign: vi.fn(),
  getLocalReferences: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  campaigns: { id: "campaigns.id", workspaceId: "campaigns.workspaceId" },
  references: { campaignId: "references.campaignId" },
  db: {
    query: {
      campaigns: { findFirst: campaignFindMock },
      references: { findFirst: referencesFindMock },
    },
  },
}));

vi.mock("@/lib/llm", () => ({
  getAIForTask: vi.fn(() => ({
    complete: completeMock,
  })),
}));

describe("POST /api/desk/chat", () => {
  beforeEach(() => {
    completeMock.mockReset();
    campaignFindMock.mockReset();
    referencesFindMock.mockReset();
    completeMock.mockResolvedValue("Keep going.");
    campaignFindMock.mockResolvedValue({ id: "campaign_1", workspaceId: "workspace_1" });
    referencesFindMock.mockResolvedValue({
      doc: {
        selfVision: { body: "I write as a patient operator." },
        voiceRules: { rules: ["Keep it practical."] },
        setupProfile: {
          profile: {
            selfStatement: "I write for working operators.",
            communicationPlatforms: [{ platform: "LinkedIn" }],
            voiceProfile: {
              userDescription: "Operator voice",
              toneWords: ["plainspoken"],
              avoid: ["hype"],
            },
            publicationDefaults: {
              defaultOutputTypes: ["article"],
              preserveRawLanguage: "polish_lightly",
            },
            permissions: {
              mayUseSavedMemory: false,
              mayUseUploadedVoiceExamples: false,
              mayUseWebResearch: false,
              mayPublishOrSend: false,
            },
          },
        },
      },
    });
  });

  it("injects approved campaign preferences into the Desk assistant system prompt", async () => {
    const { POST } = await import("@/app/api/desk/chat/route");

    const res = await POST(new Request("http://test.local/api/desk/chat", {
      method: "POST",
      body: JSON.stringify({
        campaignId: "campaign_1",
        mode: "desk",
        task: "utility",
        memory: "Earlier setup said this is a launch plan.",
        messages: [{ role: "user", content: "Help me start." }],
      }),
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "Keep going." });
    expect(completeMock).toHaveBeenCalledTimes(1);
    const [, system] = completeMock.mock.calls[0];
    expect(system).toContain("Approved campaign preferences and setup profile:");
    expect(system).toContain("SELF-VISION (public identity):\nI write as a patient operator.");
    expect(system).toContain("CLARITY RULES:");
    expect(system).toContain("Keep it practical.");
    expect(system).toContain("APPROVED SETUP PROFILE:");
    expect(system).toContain("Self statement: I write for working operators.");
    expect(system).toContain("Communication platforms: LinkedIn");
    expect(system).toContain("Tone words: plainspoken");
    expect(system).toContain("Avoid: hype");
    expect(system).toContain("Permissions: memory=not approved; examples=not approved; web=not approved; publish/send=not approved");
    expect(system).toContain("Earlier folded context:\nEarlier setup said this is a launch plan.");
  });

  it("returns 404 instead of leaking out-of-scope campaigns", async () => {
    campaignFindMock.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/desk/chat/route");

    const res = await POST(new Request("http://test.local/api/desk/chat", {
      method: "POST",
      body: JSON.stringify({
        campaignId: "not_mine",
        messages: [{ role: "user", content: "Hello" }],
      }),
    }));

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found" });
    expect(completeMock).not.toHaveBeenCalled();
  });
});
