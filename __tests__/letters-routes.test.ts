import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let capturedPrompt = "";

beforeEach(() => {
  vi.resetModules();
  capturedPrompt = "";
  dir = mkdtempSync(join(tmpdir(), "kings-press-letters-"));
  process.env.KINGS_PRESS_DATA_DIR = dir;
  process.env.KINGS_PRESS_LOCAL_FIRST = "true";
  vi.doMock("@/lib/llm", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/llm")>();
    return {
      ...actual,
      getAIForTaskForUser: vi.fn(async () => ({
        providerSource: "managed",
        provider: "ollama",
        model: "test-model",
        profileId: null,
        ai: {
          text: vi.fn(async (prompt: string) => {
            capturedPrompt = prompt;
            return "Dear Ada,\n\nThank you for reading the draft.\n\nWarmly,\nKing's Press";
          }),
        },
      })),
    };
  });
});

afterEach(async () => {
  const { resetLocalDbForTests } = await import("@/lib/local/database");
  resetLocalDbForTests();
  delete process.env.KINGS_PRESS_DATA_DIR;
  delete process.env.KINGS_PRESS_LOCAL_FIRST;
  vi.doUnmock("@/lib/llm");
  rmSync(dir, { recursive: true, force: true });
});

describe("letter workflow routes", () => {
  it("creates a normal campaign piece from a local-first letter workflow", async () => {
    const {
      createLocalCampaign,
      createLocalLetterRecipient,
      createLocalLetterWorkflow,
      getLocalLetterWorkflow,
      getLocalPiece,
    } = await import("@/lib/local/database");
    const campaign = createLocalCampaign({ name: "Letter Campaign" });
    const recipient = createLocalLetterRecipient({
      displayName: "Ada Lovelace",
      defaultTone: "Warm and precise.",
      notes: "Appreciates direct structure.",
    });
    const workflow = createLocalLetterWorkflow({
      campaignId: campaign.id,
      recipientId: recipient.id,
      recipientSnapshot: { displayName: recipient.displayName, notes: recipient.notes },
      purpose: "Ask Ada to review the launch letter.",
      desiredOutcome: "Receive feedback this week.",
      uploads: [{ name: "example.md", text: "An older letter sample." }],
      dictationTranscript: "Mention gratitude.",
    });

    const { POST } = await import("../app/api/letter-workflows/[id]/draft/route");
    const response = await POST(new Request("http://test.local/api/letter-workflows/" + workflow!.id + "/draft", {
      method: "POST",
      body: JSON.stringify({}),
    }), { params: Promise.resolve({ id: workflow!.id }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.piece).toMatchObject({
      campaignId: campaign.id,
      title: "Letter to Ada Lovelace",
      status: "Draft",
      category: "letter",
      original: expect.stringContaining("Dear Ada"),
    });
    expect(data.piece.categoryContext).toMatchObject({ letterWorkflowId: workflow!.id, recipientId: recipient.id });
    expect(getLocalPiece(data.piece.id, "local-owner")?.original).toContain("Thank you for reading");
    expect(getLocalLetterWorkflow(workflow!.id)?.pieceId).toBe(data.piece.id);
    expect(capturedPrompt).toContain("Ask Ada to review the launch letter.");
    expect(capturedPrompt).toContain("example.md");
    expect(capturedPrompt).toContain("Recipient snapshot");
  });

  it("rejects secret-like recipient fields before storage", async () => {
    const { POST } = await import("../app/api/recipients/route");
    const response = await POST(new Request("http://test.local/api/recipients", {
      method: "POST",
      body: JSON.stringify({
        displayName: "Ada",
        preferences: { apiKey: "sk-nope" },
      }),
    }));
    const data = await response.json();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(data)).toContain("credentials");
  });
});
