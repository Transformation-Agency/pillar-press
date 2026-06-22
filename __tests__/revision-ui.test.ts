import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("revision tab UI wiring", () => {
  it("offers accept revision and keeps trace/changelog while moving text into the draft", () => {
    const source = readFileSync(new URL("../public/screen-revision.jsx", import.meta.url), "utf8");

    expect(source).toContain("const acceptRevision = () =>");
    expect(source).toContain("const patch = { original: rev.text }");
    expect(source).toContain("patch.status = \"Revised\"");
    expect(source).toContain("Accept revision");
    expect(source).toContain("Accepted into draft");
    expect(source).not.toContain("revision: null");
  });
});
