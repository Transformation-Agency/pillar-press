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
});
