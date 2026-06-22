import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function loadBrowserLibrary() {
  const source = readFileSync(new URL("../public/library.js", import.meta.url), "utf8");
  const window = {} as Record<string, unknown>;
  runInNewContext(source, { window });
  return window.LIBRARY as any;
}

describe("browser Library helpers", () => {
  it("surfaces restored documents from other campaigns even when the active focus has pieces", () => {
    const library = loadBrowserLibrary();
    const campaigns = [
      { id: "focus_1", name: "Untitled focus", pieceCount: 1 },
      { id: "me", name: "Me", pieceCount: 0 },
      { id: "feature", name: "Untitled Feature", pieceCount: 5 },
    ];
    const allPieces = [
      { id: "current_piece", campaignId: "focus_1" },
      { id: "legacy_1", campaignId: "me" },
      { id: "legacy_2", campaignId: "me" },
      { id: "feature_1", campaignId: "feature" },
    ];

    expect(library.campaignsWithRestoredPieces(campaigns, allPieces, "focus_1", 4)).toEqual([
      { campaign: campaigns[1], count: 2 },
      { campaign: campaigns[2], count: 1 },
    ]);
  });
});
