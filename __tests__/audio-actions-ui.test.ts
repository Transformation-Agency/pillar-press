import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

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
    const audio = readFileSync(new URL("../public/audio-actions.jsx", import.meta.url), "utf8");

    expect(audio).toContain("const body = readText()");
    expect(audio).toContain("if (!body) return");
    expect(audio).toContain("if (window.speechSynthesis)");
    expect(audio).toContain("window.speechSynthesis.cancel()");
    expect(audio).toContain("new SpeechSynthesisUtterance(body.slice(0, 12000))");
    expect(audio).toContain("utterance.onend = () => setPlaying(false)");
    expect(audio).toContain("utterance.onerror = () => { setPlaying(false); setMsg(\"Could not play this aloud.\"); }");
    expect(audio).toContain("window.speechSynthesis.speak(utterance)");
    expect(audio).toContain("Speech is not available here.");
    expect(audio).toContain("React.useEffect(() => () =>");
  });

  it("saves audio through OpenAI audio models first, then ElevenLabs voices, and downloads the result", () => {
    const audio = readFileSync(new URL("../public/audio-actions.jsx", import.meta.url), "utf8");

    expect(audio).toContain("fetch(\"/api/media/providers\"");
    expect(audio).toContain("providers.find((p) => p && p.id === \"openai\" && p.configured)");
    expect(audio).toContain("openai.models.find((m) => m && m.type === \"audio\")");
    expect(audio).toContain("type: \"audio\"");
    expect(audio).toContain("provider: \"openai\"");
    expect(audio).toContain("modelId: openaiAudioModel.id || \"gpt-4o-mini-tts\"");
    expect(audio).toContain("voiceId: \"alloy\"");
    expect(audio).toContain("fetch(\"/api/eleven/voices\"");
    expect(audio).toContain("provider: \"elevenlabs\"");
    expect(audio).toContain("modelId: \"eleven_multilingual_v2\"");
    expect(audio).toContain("throw new Error(\"No saved audio voices were found.\")");
    expect(audio).toContain("fetch(\"/api/hedra/generate\"");
    expect(audio).toContain("a.download = filename");
    expect(audio).toContain("window.Store.refreshMedia");
  });
});
