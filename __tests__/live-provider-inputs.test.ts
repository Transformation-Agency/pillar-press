import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { summarizeLiveProviderInputs } from "@/scripts/check-live-provider-inputs";

describe("live provider input preflight", () => {
  it("reports env readiness without returning secret values", () => {
    const summary = summarizeLiveProviderInputs({
      KINGS_PRESS_LIVE_OPENAI_API_KEY: "sk-live-placeholder",
      KINGS_PRESS_LIVE_XAI_API_KEY: "xai-live-placeholder",
      KINGS_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS: "yes",
      KINGS_PRESS_LIVE_DESKTOP_SETTINGS_PATH: "/tmp/does-not-exist",
    });

    expect(summary.env.KINGS_PRESS_LIVE_OPENAI_API_KEY).toBe(true);
    expect(summary.env.KINGS_PRESS_LIVE_XAI_API_KEY).toBe(true);
    expect(summary.releaseBlockerReadiness.prov004OpenAI).toBe("ready");
    expect(summary.releaseBlockerReadiness.media002SpendFlag).toBe(true);
    expect(summary.releaseBlockerReadiness.media002Providers.xai).toBe("ready");
    expect(JSON.stringify(summary)).not.toContain("sk-live-placeholder");
    expect(JSON.stringify(summary)).not.toContain("xai-live-placeholder");
  });

  it("detects saved desktop provider keys as saved-only readiness", () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-provider-inputs-"));
    const settingsPath = join(dir, "desktop-settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      profiles: [
        { id: "xai", provider: "xai", model: "grok-4.3", apiKey: "kpenc:v1:xai" },
        { id: "openai", provider: "openai", model: "gpt-4o-mini", apiKey: "kpenc:v1:openai" },
      ],
      mediaProviders: {
        elevenlabs: { apiKey: "kpenc:v1:eleven" },
      },
    }));

    const summary = summarizeLiveProviderInputs({
      KINGS_PRESS_LIVE_DESKTOP_SETTINGS_PATH: settingsPath,
    });

    expect(summary.savedSettings.exists).toBe(true);
    expect(summary.savedSettings.llmProfilesWithKeys).toEqual(["openai", "xai"]);
    expect(summary.savedSettings.mediaProvidersWithKeys).toEqual(["elevenlabs"]);
    expect(summary.releaseBlockerReadiness.prov004OpenAI).toBe("missing");
    expect(summary.releaseBlockerReadiness.media002Providers.openai).toBe("saved-only");
    expect(summary.releaseBlockerReadiness.media002Providers.xai).toBe("saved-only");
    expect(summary.releaseBlockerReadiness.media002Providers.elevenlabs).toBe("saved-only");
    expect(summary.releaseBlockerReadiness.media002Providers.hedra).toBe("missing");
    expect(JSON.stringify(summary)).not.toContain("kpenc:v1:xai");
  });
});
