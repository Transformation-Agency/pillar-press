import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const source = () => readFileSync(new URL("../public/screen-letter.jsx", import.meta.url), "utf8");

function createLetterDeskHarness(options: {
  recipients?: Record<string, any>[];
  workflows?: Record<string, any>[];
  selectedRecipientId?: string;
  selectedWorkflowId?: string;
  recipientDraft?: Record<string, any>;
  workflowDraft?: Record<string, any>;
  draftResult?: Record<string, any>;
} = {}) {
  const screen = source();
  const start = screen.indexOf("function LetterDesk");
  const end = screen.indexOf("\n  return (", start);
  if (start === -1 || end === -1) throw new Error("Could not locate LetterDesk setup source.");
  const executableSource = `${screen.slice(start, end)}
  return {
    generateDraft,
    removeUpload,
    saveRecipient,
    saveWorkflow,
    uploadFiles,
    state: () => ({
      selectedRecipientId: __states[0],
      selectedWorkflowId: __states[1],
      recipientDraft: __states[2],
      workflowDraft: __states[3],
      busy: __states[4],
      message: __states[5],
      error: __states[6],
    }),
  };
}
return LetterDesk;`;

  const recipients = options.recipients || [{
    id: "recip-1",
    displayName: "Mom",
    organization: "Family",
    role: "Parent",
    relationship: "She likes concise, warm letters.",
    defaultSalutation: "Dear Mom,",
    defaultSignoff: "Love, Paul",
    defaultTone: "warm and specific",
    notes: "Mention ordinary details.",
    preferences: { structure: "short paragraphs" },
  }];
  const workflows = options.workflows || [];
  const states: unknown[] = [
    options.selectedRecipientId ?? (recipients[0] ? recipients[0].id : ""),
    options.selectedWorkflowId ?? (workflows[0] ? workflows[0].id : ""),
    Object.assign({
      displayName: "",
      organization: "",
      role: "",
      relationship: "",
      defaultSalutation: "",
      defaultSignoff: "",
      defaultTone: "",
      notes: "",
    }, options.recipientDraft || {}),
    Object.assign({
      purpose: "Thank her for helping with the move.",
      desiredOutcome: "She feels appreciated.",
      occasion: "After the move",
      tone: "gentle",
      constraints: "Keep it under one page.",
      sourceContext: "She packed the kitchen first.",
      dictationTranscript: "Tell her the blue mugs made it safely.",
      uploads: [{ name: "example.txt", text: "Use concrete details.", size: 21, mimeType: "text/plain" }],
    }, options.workflowDraft || {}),
    "",
    "",
    "",
  ];
  let stateIndex = 0;
  const React = {
    useState(initial: unknown) {
      const index = stateIndex++;
      if (states[index] === undefined) states[index] = initial;
      return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(states[index]) : next; }] as const;
    },
    useRef(initial: unknown) {
      return { current: initial };
    },
    useEffect(fn: () => void) {
      fn();
    },
  };
  const Store = {
    getState: vi.fn(() => ({})),
    getRecipients: vi.fn(() => recipients),
    getLetterWorkflows: vi.fn(() => workflows),
    refreshRecipients: vi.fn(async () => recipients),
    refreshLetterWorkflows: vi.fn(async () => workflows),
    createRecipient: vi.fn(async (payload) => Object.assign({ id: "recip-new" }, payload)),
    createLetterWorkflow: vi.fn(async (payload) => Object.assign({ id: "workflow-new", status: "draft" }, payload)),
    updateLetterWorkflow: vi.fn(async (id, payload) => Object.assign({ id, status: "draft" }, payload)),
    draftLetterWorkflow: vi.fn(async () => options.draftResult || { piece: { id: "piece-letter" }, workflow: { id: "workflow-new", pieceId: "piece-letter" } }),
  };
  const window = {
    Store,
    useIsMobile: () => false,
    extractFileText: vi.fn(async (file: any) => `extracted:${file.name}`),
    UPLOAD_ACCEPT: ".txt",
    relTime: () => "just now",
  };
  const onOpenPiece = vi.fn();
  const LetterDesk = new Function("React", "window", "__states", "Spinner", "Icon", executableSource)(
    React,
    window,
    states,
    () => null,
    () => null,
  ) as (props: Record<string, unknown>) => {
    generateDraft: () => Promise<void>;
    removeUpload: (index: number) => void;
    saveRecipient: () => Promise<void>;
    saveWorkflow: () => Promise<Record<string, unknown> | null>;
    uploadFiles: (files: unknown[]) => Promise<void>;
    state: () => Record<string, unknown>;
  };

  return {
    component: LetterDesk({ campaignId: "campaign-1", onOpenPiece }),
    onOpenPiece,
    states,
    window,
  };
}

describe("browser Letter workflow screen", () => {
  it("renders saved-recipient fields and persists the expected recipient payload", () => {
    const screen = source();

    expect(screen).toContain('placeholder="Display name"');
    expect(screen).toContain('placeholder="Organization"');
    expect(screen).toContain('placeholder="Role"');
    expect(screen).toContain('placeholder="Default salutation"');
    expect(screen).toContain('placeholder="Default signoff"');
    expect(screen).toContain('placeholder="Default tone"');
    expect(screen).toContain('placeholder="Relationship context"');
    expect(screen).toContain('placeholder="Recipient notes, preferences, structure guidance"');
    expect(screen).toContain("window.Store.createRecipient({");
    expect(screen).toContain("displayName: recipientDraft.displayName");
    expect(screen).toContain("relationship: recipientDraft.relationship || null");
    expect(screen).toContain("defaultTone: recipientDraft.defaultTone || null");
    expect(screen).toContain("preferences: {}");
    expect(screen).toContain('setMessage("Recipient saved.")');
  });

  it("captures letter workflow guidance, uploads, dictation, and recipient snapshots", () => {
    const screen = source();

    expect(screen).toContain('placeholder="Occasion"');
    expect(screen).toContain('placeholder="Tone for this letter"');
    expect(screen).toContain('placeholder="Desired outcome"');
    expect(screen).toContain('placeholder="Purpose"');
    expect(screen).toContain('placeholder="Structure, boundaries, lines to avoid"');
    expect(screen).toContain('placeholder="Manual guidance or pasted background"');
    expect(screen).toContain('placeholder="Dictation transcript"');
    expect(screen).toContain("recipientSnapshot: snapshotFor(selectedRecipient)");
    expect(screen).toContain("await window.Store.updateLetterWorkflow(selectedWorkflow.id, payload)");
    expect(screen).toContain("await window.Store.createLetterWorkflow(payload)");
    expect(screen).toContain("const text = await window.extractFileText(file)");
    expect(screen).toContain("extracted.push({ name: file.name, text, size: file.size, mimeType: file.type || null })");
    expect(screen).toContain('setMessage(extracted.length + " file" + (extracted.length === 1 ? "" : "s") + " added.")');
    expect(screen).toContain("removeUpload(index)");
  });

  it("saves before drafting, opens generated pieces, and exposes existing letter pieces", () => {
    const screen = source();

    expect(screen).toContain("const workflow = await saveWorkflow();");
    expect(screen).toContain("const res = await window.Store.draftLetterWorkflow(workflow.id);");
    expect(screen).toContain('setMessage("Draft saved to the campaign library.")');
    expect(screen).toContain("onOpenPiece && onOpenPiece(res.piece.id)");
    expect(screen).toContain("const pieceId = selectedWorkflow && selectedWorkflow.pieceId");
    expect(screen).toContain("onOpenPiece && onOpenPiece(pieceId)");
    expect(screen).toContain("> Open piece</button>");
    expect(screen).toContain("Generate draft");
  });

  it("executes recipient save and clears the draft after persisting local-first context", async () => {
    const harness = createLetterDeskHarness({
      selectedRecipientId: "",
      recipientDraft: {
        displayName: "Aunt Jo",
        organization: "Family",
        role: "Aunt",
        relationship: "She prefers direct updates.",
        defaultSalutation: "Dear Aunt Jo,",
        defaultSignoff: "With love, Paul",
        defaultTone: "plainspoken",
        notes: "Ask one concrete question.",
      },
    });

    await harness.component.saveRecipient();

    expect(harness.window.Store.createRecipient).toHaveBeenCalledWith({
      displayName: "Aunt Jo",
      organization: "Family",
      role: "Aunt",
      relationship: "She prefers direct updates.",
      defaultSalutation: "Dear Aunt Jo,",
      defaultSignoff: "With love, Paul",
      defaultTone: "plainspoken",
      notes: "Ask one concrete question.",
      preferences: {},
    });
    expect(harness.component.state()).toMatchObject({
      selectedRecipientId: "recip-new",
      recipientDraft: {
        displayName: "",
        organization: "",
        role: "",
        relationship: "",
        defaultSalutation: "",
        defaultSignoff: "",
        defaultTone: "",
        notes: "",
      },
      message: "Recipient saved.",
      error: "",
      busy: "",
    });
  });

  it("executes workflow save with recipient snapshot, uploads, dictation, and opens generated draft", async () => {
    const harness = createLetterDeskHarness();

    const workflow = await harness.component.saveWorkflow();

    expect(workflow).toMatchObject({ id: "workflow-new", campaignId: "campaign-1", recipientId: "recip-1" });
    expect(harness.window.Store.createLetterWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: "campaign-1",
      recipientId: "recip-1",
      purpose: "Thank her for helping with the move.",
      desiredOutcome: "She feels appreciated.",
      occasion: "After the move",
      tone: "gentle",
      constraints: "Keep it under one page.",
      sourceContext: "She packed the kitchen first.",
      dictationTranscript: "Tell her the blue mugs made it safely.",
      uploads: [{ name: "example.txt", text: "Use concrete details.", size: 21, mimeType: "text/plain" }],
      recipientSnapshot: expect.objectContaining({
        id: "recip-1",
        displayName: "Mom",
        defaultTone: "warm and specific",
        preferences: { structure: "short paragraphs" },
      }),
    }));

    await harness.component.generateDraft();

    expect(harness.window.Store.draftLetterWorkflow).toHaveBeenCalledWith("workflow-new");
    expect(harness.onOpenPiece).toHaveBeenCalledWith("piece-letter");
    expect(harness.component.state()).toMatchObject({
      selectedWorkflowId: "workflow-new",
      message: "Draft saved to the campaign library.",
      error: "",
      busy: "",
    });
  });

  it("executes file extraction and removal for letter guidance uploads", async () => {
    const harness = createLetterDeskHarness({ workflowDraft: { uploads: [] } });

    await harness.component.uploadFiles([{ name: "tone-sample.txt", size: 123, type: "text/plain" }]);

    expect(harness.window.extractFileText).toHaveBeenCalledWith({ name: "tone-sample.txt", size: 123, type: "text/plain" });
    expect(harness.component.state()).toMatchObject({
      workflowDraft: {
        uploads: [{ name: "tone-sample.txt", text: "extracted:tone-sample.txt", size: 123, mimeType: "text/plain" }],
      },
      message: "1 file added.",
      error: "",
      busy: "",
    });

    harness.component.removeUpload(0);

    expect(harness.component.state()).toMatchObject({
      workflowDraft: { uploads: [] },
    });
  });
});
