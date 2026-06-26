import { describe, expect, it, vi } from "vitest";
import { createCipheriv } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  it("serves sanitized Studio media provider status through the route", async () => {
    vi.resetModules();
    const status = {
      hedra: {
        id: "hedra",
        label: "Hedra",
        configured: true,
        sources: ["byok"],
        profileIds: ["hedra-main"],
        capabilities: ["image", "video", "avatar"],
        envVars: ["HEDRA_API_KEY"],
        models: [],
        setup: { keyLabel: "Hedra API key", summary: "Use Hedra.", helpUrl: "https://www.hedra.com/", modelPlaceholder: "Selected live" },
      },
      elevenlabs: {
        id: "elevenlabs",
        label: "ElevenLabs",
        configured: false,
        capabilities: ["audio"],
        envVars: ["ELEVENLABS_API_KEY"],
        models: [],
        setup: { keyLabel: "ElevenLabs API key", summary: "Use ElevenLabs.", helpUrl: "https://elevenlabs.io/", modelPlaceholder: "eleven-tts-multilingual-v2" },
      },
      openai: {
        id: "openai",
        label: "OpenAI",
        configured: true,
        sources: ["byok"],
        profileIds: ["openai-main"],
        capabilities: ["image", "audio"],
        envVars: ["MEDIA_OPENAI_API_KEY", "OPENAI_API_KEY"],
        models: [{ id: "gpt-image-1", name: "gpt-image-1", type: "image", provider: "openai", profileId: "openai-main" }],
        setup: { keyLabel: "OpenAI API key", summary: "Use OpenAI.", helpUrl: "https://platform.openai.com/api-keys", defaultModel: "gpt-image-1", defaultBaseUrl: "https://api.openai.com/v1", modelPlaceholder: "gpt-image-1" },
      },
      xai: {
        id: "xai",
        label: "xAI / Grok",
        configured: false,
        capabilities: ["image"],
        envVars: ["MEDIA_XAI_API_KEY", "XAI_API_KEY"],
        models: [],
        setup: { keyLabel: "xAI API key", summary: "Use xAI.", helpUrl: "https://console.x.ai/", modelPlaceholder: "grok-imagine-image-quality" },
      },
      customImage: {
        id: "custom-image",
        label: "Custom image endpoint",
        configured: false,
        capabilities: ["image"],
        envVars: ["MEDIA_IMAGE_BASE_URL", "MEDIA_IMAGE_API_KEY"],
        models: [],
        setup: { keyLabel: "Custom image API key", summary: "Use a custom endpoint.", helpUrl: "https://platform.openai.com/docs/api-reference/images", modelPlaceholder: "Provider model name" },
      },
      providers: [] as Array<{ id: string }>,
    };
    status.providers = [status.hedra, status.elevenlabs, status.openai, status.xai, status.customImage];
    const getMediaProviderStatusForUser = vi.fn(async () => status);

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/mediaProviders", () => ({ getMediaProviderStatusForUser }));

    const { GET } = await import("../app/api/media/providers/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(getMediaProviderStatusForUser).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(body.openai).toMatchObject({
      configured: true,
      sources: ["byok"],
      profileIds: ["openai-main"],
      capabilities: ["image", "audio"],
    });
    expect(body.providers.map((provider: { id: string }) => provider.id)).toEqual(["hedra", "elevenlabs", "openai", "xai", "custom-image"]);
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("sk-");
  });

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
    expect(status.openai.models.map((model) => model.id)).toEqual(expect.arrayContaining(["gpt-image-1.5", "gpt-image-1-mini"]));
    expect(status.openai.models[0]).toMatchObject({ id: "gpt-image-1.5", type: "image" });
    expect(status.xai).toMatchObject({ id: "xai", configured: true, capabilities: ["image"] });
    expect(status.openai.setup).toMatchObject({
      keyLabel: "OpenAI API key",
      defaultModel: "gpt-image-1.5",
      defaultBaseUrl: "https://api.openai.com/v1",
    });
    expect(status.xai.setup).toMatchObject({
      defaultModel: "grok-imagine-image-quality",
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
    const dir = mkdtempSync(join(tmpdir(), "pillar-press-media-"));
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
        PILLAR_PRESS_LLM_SETTINGS_PATH: settingsPath,
        PILLAR_PRESS_DESKTOP_SETTINGS_KEY: secret.keyText,
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

  it("reuses encrypted desktop xAI LLM profile keys for local media provider status", () => {
    const dir = mkdtempSync(join(tmpdir(), "pillar-press-media-xai-profile-"));
    const settingsPath = join(dir, "desktop-settings.json");
    const secret = encryptDesktopSecret("xai-profile-secret");
    writeFileSync(settingsPath, JSON.stringify({
      profiles: [{
        id: "xai-grok",
        provider: "xai",
        model: "grok-4.3",
        apiKey: secret.encrypted,
        baseUrl: "https://api.x.ai/v1",
      }],
    }));
    try {
      const status = getMediaProviderStatus({
        NODE_ENV: "test",
        PILLAR_PRESS_LLM_SETTINGS_PATH: settingsPath,
        PILLAR_PRESS_DESKTOP_SETTINGS_KEY: secret.keyText,
      });
      expect(status.xai.configured).toBe(true);
      expect(status.xai.setup.defaultModel).toBe("grok-imagine-image-quality");
      expect(JSON.stringify(status)).not.toContain("xai-profile-secret");
      expect(JSON.stringify(status)).not.toContain(secret.encrypted);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns local-first desktop media provider settings without secrets", async () => {
    vi.resetModules();
    const dir = mkdtempSync(join(tmpdir(), "pillar-press-media-settings-"));
    const settingsPath = join(dir, "desktop-settings.json");
    const secret = encryptDesktopSecret("desktop-openai-secret");
    writeFileSync(settingsPath, JSON.stringify({
      mediaProviders: {
        openai: { apiKey: secret.encrypted, baseUrl: "https://api.openai.com/v1" },
      },
    }));
    const prevPath = process.env.PILLAR_PRESS_LLM_SETTINGS_PATH;
    const prevKey = process.env.PILLAR_PRESS_DESKTOP_SETTINGS_KEY;
    process.env.PILLAR_PRESS_LLM_SETTINGS_PATH = settingsPath;
    process.env.PILLAR_PRESS_DESKTOP_SETTINGS_KEY = secret.keyText;
    try {
      vi.doMock("@/lib/auth", () => ({
        requireUser: vi.fn(async () => ({ id: "local-user", role: "author" })),
      }));
      vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
      const { GET } = await import("../app/api/media/provider-settings/route");
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({
        settings: {
          profiles: [{
            id: "desktop-openai",
            label: "openai",
            provider: "openai",
            baseUrl: "https://api.openai.com/v1",
            hasApiKey: true,
          }],
          defaultProfileId: "desktop-openai",
        },
      });
      expect(JSON.stringify(body)).not.toContain("desktop-openai-secret");
      expect(JSON.stringify(body)).not.toContain(secret.encrypted);
    } finally {
      if (prevPath === undefined) delete process.env.PILLAR_PRESS_LLM_SETTINGS_PATH;
      else process.env.PILLAR_PRESS_LLM_SETTINGS_PATH = prevPath;
      if (prevKey === undefined) delete process.env.PILLAR_PRESS_DESKTOP_SETTINGS_KEY;
      else process.env.PILLAR_PRESS_DESKTOP_SETTINGS_KEY = prevKey;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps Studio desktop media provider saves on the encrypted native bridge", () => {
    const source = readFileSync(new URL("../public/screen-studio.jsx", import.meta.url), "utf8");

    expect(source).toContain("window.PILLAR_DESKTOP");
    expect(source).toContain("desktop.saveMediaProviderKey(provider, key");
    expect(source).toContain("Provider saved encrypted on this Mac");
    expect(source).toContain("onProviderSaved={refreshProviderStatus}");
  });
});
