import { describe, expect, it } from "vitest";
import { createCipheriv } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMediaProviderStatus } from "@/lib/mediaProviders";

function encryptDesktopSecret(value: string, keyText = Buffer.alloc(32, 9).toString("base64")) {
  const key = Buffer.from(keyText, "base64");
  const nonce = Buffer.alloc(12, 4);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return {
    keyText,
    encrypted: `kpenc:v1:${nonce.toString("base64")}:${ciphertext.toString("base64")}`,
  };
}

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
    expect(status.openai.setup).toMatchObject({
      keyLabel: "OpenAI API key",
      defaultModel: "gpt-image-1",
      defaultBaseUrl: "https://api.openai.com/v1",
    });
    expect(status.xai.setup).toMatchObject({
      defaultModel: "grok-2-image",
      defaultBaseUrl: "https://api.x.ai/v1",
    });
    expect(status.customImage.setup).toMatchObject({
      keyLabel: "Custom image API key",
      modelPlaceholder: "Provider model name",
    });
    expect(status.providers).toHaveLength(5);
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  it("uses configured model lists for secret-free provider defaults", () => {
    const status = getMediaProviderStatus({
      NODE_ENV: "test",
      MEDIA_OPENAI_IMAGE_MODELS: "gpt-image-1, custom-openai-image",
      MEDIA_OPENAI_AUDIO_MODELS: "tts-1",
      MEDIA_XAI_IMAGE_MODELS: "grok-2-image-latest",
      MEDIA_IMAGE_MODELS: "custom-image-a, custom-image-b",
    });

    expect(status.openai.setup.defaultModel).toBe("gpt-image-1");
    expect(status.openai.models.map((model) => model.id)).toEqual([
      "gpt-image-1",
      "custom-openai-image",
      "tts-1",
    ]);
    expect(status.xai.setup.defaultModel).toBe("grok-2-image-latest");
    expect(status.customImage.setup.defaultModel).toBe("custom-image-a");
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  it("treats blank keys as unconfigured", () => {
    const status = getMediaProviderStatus({ NODE_ENV: "test", HEDRA_API_KEY: " ", ELEVENLABS_API_KEY: "" });
    expect(status.hedra.configured).toBe(false);
    expect(status.elevenlabs.configured).toBe(false);
  });

  it("recognizes encrypted desktop media provider keys without returning them", () => {
    const dir = mkdtempSync(join(tmpdir(), "kings-press-media-"));
    const settingsPath = join(dir, "desktop-settings.json");
    const secret = encryptDesktopSecret("media-secret");
    writeFileSync(settingsPath, JSON.stringify({
      mediaProviders: {
        openai: { apiKey: secret.encrypted },
        elevenlabs: { apiKey: secret.encrypted },
        hedra: { apiKey: secret.encrypted },
      },
    }));
    try {
      const status = getMediaProviderStatus({
        NODE_ENV: "test",
        KINGS_PRESS_LLM_SETTINGS_PATH: settingsPath,
        KINGS_PRESS_DESKTOP_SETTINGS_KEY: secret.keyText,
      });
      expect(status.openai.configured).toBe(true);
      expect(status.elevenlabs.configured).toBe(true);
      expect(status.hedra.configured).toBe(true);
      expect(JSON.stringify(status)).not.toContain("media-secret");
      expect(JSON.stringify(status)).not.toContain(secret.encrypted);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
