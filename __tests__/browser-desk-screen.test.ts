import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const screenSource = () => readFileSync(new URL("../public/screen-desk.jsx", import.meta.url), "utf8");

describe("browser Desk screen", () => {
  it("links thread model selection to llm status profiles and safe fallbacks", () => {
    const screen = screenSource();

    expect(screen).toContain('fetch("/api/llm/status"');
    expect(screen).toContain("window.addEventListener(\"pillarpress:llm-settings-changed\", refresh)");
    expect(screen).toContain("function effectiveLLMProfile(status, profileId)");
    expect(screen).toContain("function effectiveLLMProfileId(status, profileId)");
    expect(screen).toContain("status.tasks && status.tasks.utility && status.tasks.utility.profileId");
    expect(screen).toContain("status.defaultProfileId");
    expect(screen).toContain("const availableProfiles = Array.isArray(status && status.profiles)");
    expect(screen).toContain("updateThread(Object.assign({}, active, { llmProfileId: profileId || null");
    expect(screen).toContain("const llmProfileId = effectiveLLMProfileId(status, thread && thread.llmProfileId)");
    expect(screen).toContain("llmProfileId,");
    expect(screen).toContain("deskChatComplete(t, campaignId, status)");
  });
});
