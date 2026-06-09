import { describe, expect, it } from "vitest";
import { getMediaProviderStatus } from "@/lib/mediaProviders";

describe("media provider status", () => {
  it("reports optional media providers without returning secrets", () => {
    const status = getMediaProviderStatus({
      NODE_ENV: "test",
      HEDRA_API_KEY: "hedra-secret",
      ELEVENLABS_API_KEY: " eleven-secret ",
      OPENAI_API_KEY: "openai-secret",
      XAI_API_KEY: "xai-secret",
    });

    expect(status.hedra).toMatchObject({ id: "hedra", configured: true, capabilities: ["image", "video", "avatar"] });
    expect(status.elevenlabs).toMatchObject({ id: "elevenlabs", configured: true, capabilities: ["audio"] });
    expect(status.openai).toMatchObject({ id: "openai", configured: true, capabilities: ["image", "audio"] });
    expect(status.xai).toMatchObject({ id: "xai", configured: true, capabilities: ["image"] });
    expect(status.providers).toHaveLength(5);
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  it("treats blank keys as unconfigured", () => {
    const status = getMediaProviderStatus({ NODE_ENV: "test", HEDRA_API_KEY: " ", ELEVENLABS_API_KEY: "" });
    expect(status.hedra.configured).toBe(false);
    expect(status.elevenlabs.configured).toBe(false);
  });
});
