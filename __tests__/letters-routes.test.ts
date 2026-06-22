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
  it("creates, lists, updates, and deletes saved recipients in local-first mode", async () => {
    const recipientsRoute = await import("../app/api/recipients/route");

    const createResponse = await recipientsRoute.POST(new Request("http://test.local/api/recipients", {
      method: "POST",
      body: JSON.stringify({
        displayName: "Ada Lovelace",
        organization: "Analytical Engine Society",
        role: "Reviewer",
        relationship: "Longtime collaborator",
        defaultSalutation: "Dear Ada,",
        defaultSignoff: "Warmly,",
        defaultTone: "Warm, precise, and direct.",
        notes: "Prefers the ask in the first paragraph.",
        preferences: { structure: "short opening, context, ask" },
      }),
    }));
    const created = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created.recipient).toMatchObject({
      displayName: "Ada Lovelace",
      relationship: "Longtime collaborator",
      defaultTone: "Warm, precise, and direct.",
      preferences: { structure: "short opening, context, ask" },
    });

    const listResponse = await recipientsRoute.GET();
    const listed = await listResponse.json();
    expect(listed.recipients.map((recipient: { displayName: string }) => recipient.displayName)).toEqual(["Ada Lovelace"]);

    const recipientRoute = await import("../app/api/recipients/[id]/route");
    const patchResponse = await recipientRoute.PATCH(new Request("http://test.local/api/recipients/" + created.recipient.id, {
      method: "PATCH",
      body: JSON.stringify({
        defaultTone: "Tender and concrete.",
        notes: "Mention the shared draft before the ask.",
      }),
    }), { params: Promise.resolve({ id: created.recipient.id }) });
    const patched = await patchResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(patched.recipient).toMatchObject({
      id: created.recipient.id,
      defaultTone: "Tender and concrete.",
      notes: "Mention the shared draft before the ask.",
    });

    const deleteResponse = await recipientRoute.DELETE(new Request("http://test.local/api/recipients/" + created.recipient.id), {
      params: Promise.resolve({ id: created.recipient.id }),
    });
    expect(deleteResponse.status).toBe(200);

    const afterDelete = await recipientsRoute.GET();
    const remaining = await afterDelete.json();
    expect(remaining.recipients).toEqual([]);
  });

  it("creates, lists, updates, and deletes local-first letter workflows through the API", async () => {
    const {
      createLocalCampaign,
      createLocalLetterRecipient,
      getLocalLetterWorkflow,
    } = await import("@/lib/local/database");
    const campaign = createLocalCampaign({ name: "Family letters" });
    const recipient = createLocalLetterRecipient({
      displayName: "Ada Lovelace",
      relationship: "Longtime collaborator",
      defaultTone: "Warm, precise, and direct.",
      notes: "Prefers a clear ask near the top.",
      preferences: { structure: "short opening, context, ask" },
    });
    const workflowsRoute = await import("../app/api/letter-workflows/route");

    const createResponse = await workflowsRoute.POST(new Request("http://test.local/api/letter-workflows", {
      method: "POST",
      body: JSON.stringify({
        campaignId: campaign.id,
        recipientId: recipient.id,
        purpose: "Ask Ada to review the launch letter.",
        desiredOutcome: "Receive feedback this week.",
        occasion: "Launch week",
        tone: "Grateful and direct.",
        constraints: "Keep it under one page and include one clear ask.",
        sourceContext: "The draft is ready for a final editorial read.",
        uploads: [{ name: "prior-letter.md", text: "Dear Ada, thank you for your notes." }],
        dictationTranscript: "Mention gratitude for her earlier comments.",
      }),
    }));
    const created = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created.workflow).toMatchObject({
      campaignId: campaign.id,
      recipientId: recipient.id,
      purpose: "Ask Ada to review the launch letter.",
      desiredOutcome: "Receive feedback this week.",
      recipientSnapshot: {
        displayName: "Ada Lovelace",
        defaultTone: "Warm, precise, and direct.",
        preferences: { structure: "short opening, context, ask" },
      },
      uploads: [{ name: "prior-letter.md", text: "Dear Ada, thank you for your notes." }],
    });

    const listResponse = await workflowsRoute.GET(new Request("http://test.local/api/letter-workflows?campaignId=" + campaign.id));
    const listed = await listResponse.json();
    expect(listed.workflows.map((workflow: { id: string }) => workflow.id)).toEqual([created.workflow.id]);

    const workflowRoute = await import("../app/api/letter-workflows/[id]/route");
    const patchResponse = await workflowRoute.PATCH(new Request("http://test.local/api/letter-workflows/" + created.workflow.id, {
      method: "PATCH",
      body: JSON.stringify({
        tone: "Tender and concrete.",
        constraints: "Open with affection, then one specific ask.",
        status: "ready",
      }),
    }), { params: Promise.resolve({ id: created.workflow.id }) });
    const patched = await patchResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(patched.workflow).toMatchObject({
      id: created.workflow.id,
      tone: "Tender and concrete.",
      constraints: "Open with affection, then one specific ask.",
      status: "ready",
    });
    expect(getLocalLetterWorkflow(created.workflow.id)?.status).toBe("ready");

    const deleteResponse = await workflowRoute.DELETE(new Request("http://test.local/api/letter-workflows/" + created.workflow.id), {
      params: Promise.resolve({ id: created.workflow.id }),
    });
    expect(deleteResponse.status).toBe(200);

    const afterDelete = await workflowsRoute.GET(new Request("http://test.local/api/letter-workflows?campaignId=" + campaign.id));
    const remaining = await afterDelete.json();
    expect(remaining.workflows).toEqual([]);
  });

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
