import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

type Check = {
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail?: Record<string, unknown>;
  error?: string;
};

const root = process.cwd();
const spendCredits = process.env.KINGS_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS === "yes";
const openaiKey = process.env.KINGS_PRESS_LIVE_OPENAI_API_KEY?.trim();
const xaiKey = process.env.KINGS_PRESS_LIVE_XAI_API_KEY?.trim() || process.env.KINGS_PRESS_LIVE_GROK_API_KEY?.trim();
const elevenKey = process.env.KINGS_PRESS_LIVE_ELEVENLABS_API_KEY?.trim();
const hedraKey = process.env.KINGS_PRESS_LIVE_HEDRA_API_KEY?.trim();
const openaiBaseUrl = (process.env.KINGS_PRESS_LIVE_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const xaiBaseUrl = (process.env.KINGS_PRESS_LIVE_XAI_BASE_URL || "https://api.x.ai/v1").replace(/\/+$/, "");
const openaiChatModel = process.env.KINGS_PRESS_LIVE_OPENAI_CHAT_MODEL?.trim();
const xaiChatModel = process.env.KINGS_PRESS_LIVE_XAI_CHAT_MODEL?.trim() || "grok-4.3";
const openaiImageModel = process.env.KINGS_PRESS_LIVE_OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
const xaiImageModel = process.env.KINGS_PRESS_LIVE_XAI_IMAGE_MODEL?.trim() || "grok-2-image";
const openaiAudioModel = process.env.KINGS_PRESS_LIVE_OPENAI_AUDIO_MODEL?.trim() || "gpt-4o-mini-tts";
const ollamaBaseUrl = (process.env.KINGS_PRESS_LIVE_OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const ollamaModel = process.env.KINGS_PRESS_LIVE_OLLAMA_MODEL?.trim() || "gemma4:26b-mlx";
const llmTasks = ["gather", "weave", "draft", "review", "revision", "outputs", "utility", "mediaPrompt", "file"] as const;
const secretValues = [openaiKey, xaiKey, elevenKey, hedraKey].filter((value): value is string => Boolean(value && value.length >= 6));
const nodePath = join(root, "src-tauri", "resources", "node", "bin", "node");
const serverPath = join(root, "src-tauri", "resources", "desktop-server", "server.js");
const serverRoot = join(root, "src-tauri", "resources", "desktop-server");

function redact(text: string): string {
  let out = text;
  for (const secret of secretValues) {
    out = out.split(secret).join("[redacted-secret]");
  }
  out = out.replace(/\b(sk-[A-Za-z0-9_\-]{8,})\b/g, "[redacted-openai-key]");
  out = out.replace(/\b(xai-[A-Za-z0-9_\-]{8,})\b/g, "[redacted-xai-key]");
  out = out.replace(/\b(xi-[A-Za-z0-9_\-]{8,})\b/g, "[redacted-elevenlabs-key]");
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/gi, "Bearer [redacted]");
  return out;
}

function assertNoSecrets(value: unknown, label: string) {
  const text = JSON.stringify(value);
  for (const secret of secretValues) {
    if (text.includes(secret)) throw new Error(`${label} leaked a provider secret.`);
  }
  if (/\bsk-[A-Za-z0-9_\-]{8,}\b/.test(text)) throw new Error(`${label} leaked an OpenAI-shaped key.`);
  if (/\bxai-[A-Za-z0-9_\-]{8,}\b/.test(text)) throw new Error(`${label} leaked an xAI-shaped key.`);
  if (/\bxi-[A-Za-z0-9_\-]{8,}\b/.test(text)) throw new Error(`${label} leaked an ElevenLabs-shaped key.`);
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForReady(baseUrl: string) {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`${baseUrl}/api/llm/status`);
      if (res.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Packaged server did not become ready at ${baseUrl}`);
}

async function requestJson(baseUrl: string, path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(async () => ({ raw: await res.text().catch(() => "") }));
  assertNoSecrets(body, path);
  if (!res.ok) {
    throw new Error(`${path} returned ${res.status}: ${redact(JSON.stringify(body))}`);
  }
  return body;
}

async function runCheck(checks: Check[], name: string, fn: () => Promise<Record<string, unknown> | void>) {
  try {
    const detail = await fn();
    checks.push({ name, ok: true, detail: detail ?? undefined });
    console.log(`ok ${name}`);
  } catch (error) {
    checks.push({ name, ok: false, error: redact(error instanceof Error ? error.message : String(error)) });
    console.log(`not ok ${name}`);
  }
}

function skip(checks: Check[], name: string, reason: string) {
  checks.push({ name, ok: true, skipped: true, detail: { reason } });
  console.log(`skip ${name}: ${reason}`);
}

function modelIds(payload: unknown): string[] {
  const body = payload as { models?: unknown[] };
  return Array.isArray(body.models) ? body.models.filter((item): item is string => typeof item === "string") : [];
}

function providerConfigured(payload: unknown, provider: string): boolean {
  const body = payload as Record<string, { configured?: boolean } | undefined>;
  return Boolean(body[provider]?.configured);
}

async function main() {
  if (!(await exists(nodePath)) || !(await exists(serverPath))) {
    throw new Error("Missing packaged desktop server resources. Run `npm run desktop:web:build` or `npm run desktop:build` first.");
  }

  const dataDir = await mkdtemp(join(tmpdir(), "kings-press-live-provider-"));
  const settingsPath = join(dataDir, "desktop-settings.json");
  const taskDefaults = Object.fromEntries(llmTasks.map((task) => [task, "ollama-local"]));
  await writeFile(settingsPath, JSON.stringify({
    provider: "ollama",
    model: ollamaModel,
    baseUrl: ollamaBaseUrl,
    profiles: [{
      id: "ollama-local",
      label: "Ollama local",
      provider: "ollama",
      model: ollamaModel,
      baseUrl: ollamaBaseUrl,
    }],
    defaultProfileId: "ollama-local",
    taskDefaults,
  }, null, 2));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(nodePath, [serverPath], {
    cwd: serverRoot,
    stdio: "pipe",
    env: {
      HOME: dataDir,
      TMPDIR: tmpdir(),
      PATH: process.env.PATH || "",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      KINGS_PRESS_LOCAL_FIRST: "true",
      DATA_BACKEND: "sqlite",
      STORAGE_PROVIDER: "local",
      KINGS_PRESS_STORAGE: "local",
      KINGS_PRESS_DATA_DIR: dataDir,
      KINGS_PRESS_LLM_SETTINGS_PATH: settingsPath,
      OPENAI_API_KEY: openaiKey || "",
      MEDIA_OPENAI_API_KEY: openaiKey || "",
      MEDIA_OPENAI_BASE_URL: openaiBaseUrl,
      XAI_API_KEY: xaiKey || "",
      MEDIA_XAI_API_KEY: xaiKey || "",
      MEDIA_XAI_BASE_URL: xaiBaseUrl,
      ELEVENLABS_API_KEY: elevenKey || "",
      HEDRA_API_KEY: hedraKey || "",
    },
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data.toString(); });
  child.stderr.on("data", (data) => { output += data.toString(); });

  const checks: Check[] = [];
  try {
    await waitForReady(baseUrl);
    const status = await requestJson(baseUrl, "/api/llm/status");
    assertNoSecrets(status, "llm status");
    console.log(`ok packaged server ready ${baseUrl}`);
    await runCheck(checks, "PROV-005 Ollama desktop task defaults", async () => {
      const body = status as {
        provider?: string;
        model?: string;
        defaultProfileId?: string;
        taskDefaults?: Record<string, string>;
        tasks?: Record<string, { provider?: string; model?: string; profileId?: string }>;
      };
      if (body.provider !== "ollama" || body.model !== ollamaModel) {
        throw new Error(`Packaged server did not load the local Ollama default: ${JSON.stringify(body)}`);
      }
      const mappedTasks = llmTasks.filter((task) => body.taskDefaults?.[task] === "ollama-local" || body.tasks?.[task]?.model === ollamaModel);
      if (mappedTasks.length !== llmTasks.length) {
        throw new Error(`Expected all LLM tasks to map to ${ollamaModel}; got ${mappedTasks.length}/${llmTasks.length}.`);
      }
      return { provider: body.provider, model: body.model, mappedTasks: mappedTasks.length };
    });

    const providers = await requestJson(baseUrl, "/api/media/providers");
    await runCheck(checks, "secret-free media provider catalog", async () => {
      assertNoSecrets(providers, "media providers");
      return {
        openaiConfigured: providerConfigured(providers, "openai"),
        xaiConfigured: providerConfigured(providers, "xai"),
        elevenlabsConfigured: providerConfigured(providers, "elevenlabs"),
        hedraConfigured: providerConfigured(providers, "hedra"),
      };
    });

    await runCheck(checks, "PROV-005 Ollama model listing", async () => {
      const modelsPayload = await requestJson(baseUrl, "/api/llm/models", {
        method: "POST",
        body: JSON.stringify({ provider: "ollama", baseUrl: ollamaBaseUrl }),
      });
      const models = modelIds(modelsPayload);
      if (!models.includes(ollamaModel)) throw new Error(`Ollama did not list ${ollamaModel}. Listed: ${models.join(", ")}`);
      if (models.some((model) => /embed/i.test(model))) throw new Error(`Ollama listing included embedding-only model(s): ${models.join(", ")}`);
      return { modelCount: models.length, firstModel: models[0], requestedModel: ollamaModel };
    });

    await runCheck(checks, "PROV-005 Ollama text test", async () => {
      const body = await requestJson(baseUrl, "/api/llm/test", {
        method: "POST",
        body: JSON.stringify({
          provider: "ollama",
          baseUrl: ollamaBaseUrl,
          model: ollamaModel,
        }),
      });
      if ((body as { sample?: string }).sample?.trim() !== "OK") throw new Error(`Unexpected Ollama sample: ${JSON.stringify(body)}`);
      return { model: ollamaModel };
    });

    await runCheck(checks, "PROV-005 Ollama task-default utility call", async () => {
      const body = await requestJson(baseUrl, "/api/llm/util", {
        method: "POST",
        body: JSON.stringify({
          task: "utility",
          prompt: "Reply with exactly: KINGSPRESS_GEMMA4_OK",
        }),
      });
      const text = (body as { text?: string }).text?.trim();
      if (text !== "KINGSPRESS_GEMMA4_OK") throw new Error(`Unexpected Ollama utility response: ${JSON.stringify(body)}`);
      return { model: ollamaModel, text };
    });

    if (openaiKey) {
      let chosenChatModel = openaiChatModel;
      await runCheck(checks, "PROV-004 OpenAI chat model listing", async () => {
        const modelsPayload = await requestJson(baseUrl, "/api/llm/models", {
          method: "POST",
          body: JSON.stringify({ provider: "openai", apiKey: openaiKey, baseUrl: openaiBaseUrl }),
        });
        const models = modelIds(modelsPayload);
        chosenChatModel ||= models[0];
        if (!chosenChatModel) throw new Error("OpenAI listed no chat-capable models.");
        return { modelCount: models.length, chosenModel: chosenChatModel };
      });
      if (chosenChatModel) {
        await runCheck(checks, "PROV-004 OpenAI text test", async () => {
          const body = await requestJson(baseUrl, "/api/llm/test", {
            method: "POST",
            body: JSON.stringify({
              provider: "openai",
              apiKey: openaiKey,
              baseUrl: openaiBaseUrl,
              model: chosenChatModel,
            }),
          });
          if ((body as { sample?: string }).sample?.trim() !== "OK") throw new Error(`Unexpected OpenAI sample: ${JSON.stringify(body)}`);
          return { model: chosenChatModel };
        });
      }
      await runCheck(checks, "OpenAI media provider configured", async () => {
        if (!providerConfigured(providers, "openai")) throw new Error("OpenAI media provider was not configured in packaged local server.");
        return { imageModel: openaiImageModel, audioModel: openaiAudioModel };
      });
      if (spendCredits) {
        await runCheck(checks, "MEDIA-002 OpenAI image generation", async () => {
          const body = await requestJson(baseUrl, "/api/hedra/generate", {
            method: "POST",
            body: JSON.stringify({
              type: "image",
              provider: "openai",
              modelId: openaiImageModel,
              prompt: "A simple editorial desk with a notebook and warm morning light.",
              aspectRatio: "1:1",
              resolution: "1024x1024",
              enhance: false,
              directed: true,
            }),
          });
          const job = (body as { job?: { status?: string; outputUrl?: string; meta?: unknown } }).job;
          if (job?.status !== "completed" || !job.outputUrl) throw new Error("OpenAI image generation did not complete with an output URL.");
          assertNoSecrets(job, "OpenAI image job");
          return { status: job.status, hasOutputUrl: true, meta: job.meta };
        });
        await runCheck(checks, "MEDIA-002 OpenAI saved TTS generation", async () => {
          const body = await requestJson(baseUrl, "/api/hedra/generate", {
            method: "POST",
            body: JSON.stringify({
              type: "audio",
              provider: "openai",
              modelId: openaiAudioModel,
              prompt: "King's Press live audio verification.",
              script: "King's Press live audio verification.",
              voiceId: "alloy",
            }),
          });
          const job = (body as { job?: { status?: string; outputUrl?: string; meta?: unknown } }).job;
          if (job?.status !== "completed" || !job.outputUrl) throw new Error("OpenAI audio generation did not complete with an output URL.");
          assertNoSecrets(job, "OpenAI audio job");
          return { status: job.status, hasOutputUrl: true, meta: job.meta };
        });
      } else {
        skip(checks, "MEDIA-002 OpenAI image generation", "set KINGS_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS=yes to spend provider credits");
        skip(checks, "MEDIA-002 OpenAI saved TTS generation", "set KINGS_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS=yes to spend provider credits");
      }
    } else {
      skip(checks, "PROV-004 OpenAI live checks", "KINGS_PRESS_LIVE_OPENAI_API_KEY not set");
    }

    if (xaiKey) {
      await runCheck(checks, "PROV-006 xAI/Grok model listing", async () => {
        const modelsPayload = await requestJson(baseUrl, "/api/llm/models", {
          method: "POST",
          body: JSON.stringify({ provider: "xai", apiKey: xaiKey, baseUrl: xaiBaseUrl }),
        });
        const models = modelIds(modelsPayload);
        if (!models.length) throw new Error("xAI listed no usable models.");
        if (!models.includes(xaiChatModel)) throw new Error(`xAI did not list ${xaiChatModel}. Listed: ${models.join(", ")}`);
        return { modelCount: models.length, requestedModel: xaiChatModel };
      });
      await runCheck(checks, "PROV-006 xAI/Grok text test", async () => {
        const body = await requestJson(baseUrl, "/api/llm/test", {
          method: "POST",
          body: JSON.stringify({
            provider: "xai",
            apiKey: xaiKey,
            baseUrl: xaiBaseUrl,
            model: xaiChatModel,
          }),
        });
        if ((body as { sample?: string }).sample?.trim() !== "OK") throw new Error(`Unexpected xAI sample: ${JSON.stringify(body)}`);
        return { model: xaiChatModel };
      });
      await runCheck(checks, "MEDIA-002 xAI image provider configured", async () => {
        if (!providerConfigured(providers, "xai")) throw new Error("xAI media provider was not configured in packaged local server.");
        return { imageModel: xaiImageModel };
      });
      if (spendCredits) {
        await runCheck(checks, "MEDIA-002 xAI image generation", async () => {
          const body = await requestJson(baseUrl, "/api/hedra/generate", {
            method: "POST",
            body: JSON.stringify({
              type: "image",
              provider: "xai",
              modelId: xaiImageModel,
              prompt: "A simple editorial desk with a notebook and warm morning light.",
              aspectRatio: "1:1",
              resolution: "1024x1024",
              enhance: false,
              directed: true,
            }),
          });
          const job = (body as { job?: { status?: string; outputUrl?: string; meta?: unknown } }).job;
          if (job?.status !== "completed" || !job.outputUrl) throw new Error("xAI image generation did not complete with an output URL.");
          assertNoSecrets(job, "xAI image job");
          return { status: job.status, hasOutputUrl: true, meta: job.meta };
        });
      } else {
        skip(checks, "MEDIA-002 xAI image generation", "set KINGS_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS=yes to spend provider credits");
      }
    } else {
      skip(checks, "PROV-006 xAI/Grok live checks", "KINGS_PRESS_LIVE_XAI_API_KEY or KINGS_PRESS_LIVE_GROK_API_KEY not set");
    }

    if (elevenKey) {
      let voiceId = process.env.KINGS_PRESS_LIVE_ELEVENLABS_VOICE_ID?.trim();
      await runCheck(checks, "MEDIA-002 ElevenLabs voice listing", async () => {
        const body = await requestJson(baseUrl, "/api/eleven/voices");
        const voices = (body as { voices?: Array<{ id?: string; name?: string }> }).voices || [];
        voiceId ||= voices[0]?.id;
        if (!voiceId) throw new Error("ElevenLabs returned no usable voices.");
        return { voiceCount: voices.length, chosenVoiceId: voiceId };
      });
      if (spendCredits && voiceId) {
        await runCheck(checks, "MEDIA-002 ElevenLabs saved TTS generation", async () => {
          const body = await requestJson(baseUrl, "/api/hedra/generate", {
            method: "POST",
            body: JSON.stringify({
              type: "audio",
              provider: "elevenlabs",
              modelId: "eleven_multilingual_v2",
              prompt: "King's Press ElevenLabs verification.",
              script: "King's Press ElevenLabs verification.",
              voiceId,
            }),
          });
          const job = (body as { job?: { status?: string; outputUrl?: string; meta?: unknown } }).job;
          if (job?.status !== "completed" || !job.outputUrl) throw new Error("ElevenLabs audio generation did not complete with an output URL.");
          assertNoSecrets(job, "ElevenLabs audio job");
          return { status: job.status, hasOutputUrl: true, meta: job.meta };
        });
      } else if (voiceId) {
        skip(checks, "MEDIA-002 ElevenLabs saved TTS generation", "set KINGS_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS=yes to spend provider credits");
      }
    } else {
      skip(checks, "MEDIA-002 ElevenLabs live checks", "KINGS_PRESS_LIVE_ELEVENLABS_API_KEY not set");
    }

    if (hedraKey) {
      await runCheck(checks, "MEDIA-002 Hedra model listing", async () => {
        const body = await requestJson(baseUrl, "/api/hedra/models?type=image,video,avatar_video");
        const models = (body as { models?: Array<{ id?: string; name?: string; type?: string }>; source?: string }).models || [];
        if (!models.length) throw new Error("Hedra returned no models.");
        return { source: (body as { source?: string }).source, modelCount: models.length };
      });
      skip(checks, "MEDIA-002 Hedra generation", "manual verification recommended for credit-heavy video/avatar generation");
    } else {
      skip(checks, "MEDIA-002 Hedra live checks", "KINGS_PRESS_LIVE_HEDRA_API_KEY not set");
    }

    const failed = checks.filter((check) => !check.ok);
    const summary = {
      baseUrl,
      spendCredits,
      checks,
      passed: checks.length - failed.length,
      failed: failed.length,
    };
    assertNoSecrets(summary, "summary");
    console.log(JSON.stringify(summary, null, 2));
    if (failed.length) process.exitCode = 1;
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!child.killed) child.kill("SIGKILL");
    if (output.trim()) {
      const startupLog = await readFile(join(dataDir, "desktop-startup.log"), "utf8").catch(() => "");
      const redactedLog = redact([output, startupLog].filter(Boolean).join("\n")).trim();
      if (process.exitCode && redactedLog) console.error(redactedLog.slice(-4000));
    }
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
