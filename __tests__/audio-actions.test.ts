import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("audio actions", () => {
  it("falls back to local system audio export when no cloud voice provider is configured", () => {
    const source = readFileSync(new URL("../public/audio-actions.jsx", import.meta.url), "utf8");

    expect(source).toContain('provider: "local-system"');
    expect(source).toContain('modelId: "macos-system-voice"');
    expect(source).toContain('voiceName = "Mac"');
    expect(source).toContain('job.meta.extension === "aiff"');
  });
});
