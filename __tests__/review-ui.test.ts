import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("review workspace UI wiring", () => {
  it("surfaces readable review route errors in the draft tab", () => {
    const app = readFileSync(new URL("../public/app.jsx", import.meta.url), "utf8");
    const workspace = readFileSync(new URL("../public/screen-workspace.jsx", import.meta.url), "utf8");

    expect(app).toContain("const [reviewError, setReviewError]");
    expect(app).toContain("setReviewError(\"\")");
    expect(app).toContain("const body = await r.json().catch(() => null)");
    expect(app).toContain("body.error || body.message");
    expect(app).toContain("reviewError={reviewError}");
    expect(workspace).toContain("function DraftTab({ piece, running, gateStatus, reviewError");
    expect(workspace).toContain("role=\"alert\"");
    expect(workspace).toContain("{reviewError}");
  });

  it("persists author direction and gate commentary for revision guidance", () => {
    const review = readFileSync(new URL("../public/screen-review.jsx", import.meta.url), "utf8");
    const store = readFileSync(new URL("../public/store.js", import.meta.url), "utf8");
    const revision = readFileSync(new URL("../lib/revision.ts", import.meta.url), "utf8");

    expect(review).toContain("function DirectionBox({ piece })");
    expect(review).toContain("window.Store.updatePiece(piece.id, { direction: valRef.current.trim() })");
    expect(review).toContain("function CommentaryBox({ piece, gateId })");
    expect(review).toContain("window.Store.updatePiece(piece.id, { gateNotes: Object.assign({}, piece.gateNotes || {}, { [gateId]: v }) })");
    expect(review).toContain("MicButton listening={dict.listening}");
    expect(store).toContain("\"direction\"");
    expect(store).toContain("\"gateNotes\"");
    expect(revision).toContain("AUTHOR'S CREATIVE DIRECTION");
    expect(revision).toContain("AUTHOR COMMENTARY BY REVIEW SECTION");
    expect(revision).toContain("buildGuidance(piece)");
  });
});
