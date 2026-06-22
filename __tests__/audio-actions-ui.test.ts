import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

type AudioActionHarness = {
  cleanup: () => void;
  component: {
    playAloud: () => void;
    saveAudio: () => Promise<void>;
    readText: () => string;
  };
  document: {
    anchors: Array<{ href: string; download: string; rel: string; clicked: boolean; remove: () => void }>;
  };
  fetchCalls: Array<{ url: string; options: RequestInit | undefined }>;
  lastUtterance: { text: string; onend?: () => void; onerror?: () => void } | null;
  speech: { cancel: ReturnType<typeof vi.fn>; speak: ReturnType<typeof vi.fn> };
  state: () => { playing: unknown; saving: unknown; msg: unknown };
  store: { activeCampaign: ReturnType<typeof vi.fn>; refreshMedia: ReturnType<typeof vi.fn> };
};

function createAudioActionHarness({
  text = "Read this.",
  providers = [],
  voices = [],
  generatedJob = { downloadUrl: "data:audio/mpeg;base64,AAA" },
}: {
  text?: string;
  providers?: Array<Record<string, unknown>>;
  voices?: Array<Record<string, unknown>>;
  generatedJob?: Record<string, unknown>;
} = {}): AudioActionHarness {
  const source = readFileSync(new URL("../public/audio-actions.jsx", import.meta.url), "utf8");
  const componentSource = source.slice(source.indexOf("function AudioActions"), source.indexOf("Object.assign(window"));
  const returnStart = componentSource.lastIndexOf("\n  return (");
  if (returnStart === -1) throw new Error("Could not locate AudioActions JSX return.");
  const executableSource = `${componentSource.slice(0, returnStart)}
  return { playAloud, saveAudio, readText };
}
return AudioActions;`;

  const states: unknown[] = [];
  const effects: Array<() => void> = [];
  let stateIndex = 0;
  const React = {
    useState(initial: unknown) {
      const index = stateIndex++;
      states[index] = initial;
      return [states[index], (next: unknown) => { states[index] = next; }] as const;
    },
    useRef(initial: unknown) {
      return { current: initial };
    },
    useEffect(callback: () => () => void) {
      effects.push(callback());
    },
  };
  let lastUtterance: AudioActionHarness["lastUtterance"] = null;
  function SpeechSynthesisUtterance(body: string) {
    lastUtterance = { text: body };
    return lastUtterance;
  }
  const speech = { cancel: vi.fn(), speak: vi.fn() };
  const store = { activeCampaign: vi.fn(() => ({ id: "camp-audio" })), refreshMedia: vi.fn() };
  const window = { speechSynthesis: speech, Store: store };
  const document = {
    anchors: [] as AudioActionHarness["document"]["anchors"],
    body: {
      appendChild(anchor: AudioActionHarness["document"]["anchors"][number]) {
        document.anchors.push(anchor);
      },
    },
    createElement(tag: string) {
      if (tag !== "a") throw new Error(`Unexpected element: ${tag}`);
      return {
        href: "",
        download: "",
        rel: "",
        clicked: false,
        click() { this.clicked = true; },
        remove() {},
      };
    },
  };
  const fetchCalls: AudioActionHarness["fetchCalls"] = [];
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    fetchCalls.push({ url, options });
    if (url === "/api/media/providers") {
      return { ok: true, json: async () => ({ providers }) };
    }
    if (url === "/api/eleven/voices") {
      return { ok: true, json: async () => ({ voices }) };
    }
    if (url === "/api/hedra/generate") {
      return { ok: true, json: async () => ({ job: generatedJob }) };
    }
    throw new Error(`Unhandled fetch: ${url}`);
  });
  const AudioActions = new Function(
    "React",
    "window",
    "document",
    "fetch",
    "SpeechSynthesisUtterance",
    executableSource,
  )(React, window, document, fetch, SpeechSynthesisUtterance) as (props: Record<string, unknown>) => AudioActionHarness["component"];
  const component = AudioActions({ text: () => text, filename: "piece-audio.mp3", pieceId: "piece-a", campaignId: "campaign-prop" });
  return {
    cleanup: () => effects.forEach((effect) => effect()),
    component,
    document,
    fetchCalls,
    get lastUtterance() {
      return lastUtterance;
    },
    speech,
    state: () => ({ playing: states[0], saving: states[1], msg: states[2] }),
    store,
  };
}

describe("audio action UI wiring", () => {
  it("exposes shared read-aloud and save-audio controls on drafts, revisions, and outputs", () => {
    const audio = readFileSync(new URL("../public/audio-actions.jsx", import.meta.url), "utf8");
    const workspace = readFileSync(new URL("../public/screen-workspace.jsx", import.meta.url), "utf8");
    const revision = readFileSync(new URL("../public/screen-revision.jsx", import.meta.url), "utf8");
    const outputs = readFileSync(new URL("../public/screen-outputs.jsx", import.meta.url), "utf8");
    const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

    expect(index).toContain('<script type="text/babel" src="audio-actions.jsx"></script>');
    expect(audio).toContain("function AudioActions({ text, label = \"text\", filename = \"audio.mp3\", pieceId = null, campaignId = null })");
    expect(audio).toContain("Object.assign(window, { AudioActions })");
    expect(workspace).toContain("<AudioActions text={() => text} label=\"draft\"");
    expect(revision).toContain("<AudioActions text={() => rev.text} label=\"revision\"");
    expect(outputs).toContain("<AudioActions text={() => o.draftPost || \"\"} label={o.platform + \" output\"}");
  });

  it("plays text aloud with browser speech and cancels/cleans up active playback", () => {
    const longText = "x".repeat(12_050);
    const harness = createAudioActionHarness({ text: longText });

    harness.component.playAloud();

    expect(harness.speech.cancel).toHaveBeenCalledTimes(1);
    expect(harness.speech.speak).toHaveBeenCalledWith(harness.lastUtterance);
    expect(harness.lastUtterance?.text).toHaveLength(12_000);
    expect(harness.state()).toMatchObject({ playing: true, msg: "" });

    harness.lastUtterance?.onend?.();
    expect(harness.state().playing).toBe(false);

    harness.cleanup();
    expect(harness.speech.cancel).toHaveBeenCalledTimes(2);
  });

  it("prefers OpenAI audio profiles when saving audio and downloads the result", async () => {
    const harness = createAudioActionHarness({
      text: "Make this an audio file.",
      providers: [{
        id: "openai",
        configured: true,
        profileIds: ["openai-default"],
        models: [{ id: "gpt-4o-mini-tts", type: "audio", profileId: "openai-audio" }],
      }],
    });

    await harness.component.saveAudio();

    const generateCall = harness.fetchCalls.find((call) => call.url === "/api/hedra/generate");
    expect(generateCall?.options?.method).toBe("POST");
    expect(JSON.parse(String(generateCall?.options?.body))).toMatchObject({
      type: "audio",
      provider: "openai",
      mediaProfileId: "openai-audio",
      modelId: "gpt-4o-mini-tts",
      script: "Make this an audio file.",
      voiceId: "alloy",
      pieceId: "piece-a",
      campaignId: "campaign-prop",
    });
    expect(harness.fetchCalls.map((call) => call.url)).not.toContain("/api/eleven/voices");
    expect(harness.document.anchors[0]).toMatchObject({
      href: "data:audio/mpeg;base64,AAA",
      download: "piece-audio.mp3",
      rel: "noopener",
      clicked: true,
    });
    expect(harness.store.refreshMedia).toHaveBeenCalledTimes(1);
    expect(harness.state()).toMatchObject({ saving: false, msg: "Audio saved with OpenAI." });
  });

  it("falls back to ElevenLabs voices when no OpenAI audio model is configured", async () => {
    const harness = createAudioActionHarness({
      providers: [{ id: "elevenlabs", configured: true, profileIds: ["eleven-main"] }],
      voices: [{ voice_id: "voice-a", name: "Narrator" }],
    });

    await harness.component.saveAudio();

    const generateCall = harness.fetchCalls.find((call) => call.url === "/api/hedra/generate");
    expect(JSON.parse(String(generateCall?.options?.body))).toMatchObject({
      type: "audio",
      provider: "elevenlabs",
      mediaProfileId: "eleven-main",
      modelId: "eleven_multilingual_v2",
      voiceId: "voice-a",
    });
    expect(harness.fetchCalls.map((call) => call.url)).toContain("/api/eleven/voices");
    expect(harness.state().msg).toBe("Audio saved with Narrator.");
  });
});
