import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = () => readFileSync(new URL("../public/screen-letter.jsx", import.meta.url), "utf8");

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
});
