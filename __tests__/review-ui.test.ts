import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

type RecognitionResultEvent = { resultIndex: number; results: Array<{ 0: { transcript: string }; isFinal: boolean }> };

type DictationHarness = {
  cleanup: () => void;
  hook: {
    listening: unknown;
    msg: unknown;
    toggle: () => void;
  };
  onDone: ReturnType<typeof vi.fn>;
  onText: ReturnType<typeof vi.fn>;
  recognition: {
    current: {
      continuous?: boolean;
      interimResults?: boolean;
      lang?: string;
      onresult?: (event: RecognitionResultEvent) => void;
      onerror?: () => void;
      onend?: () => void;
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
    } | null;
  };
  state: () => { listening: unknown; msg: unknown };
};

function createDictationHarness({
  base = "Existing note",
  recognitionAvailable = true,
  startThrows = false,
}: {
  base?: string;
  recognitionAvailable?: boolean;
  startThrows?: boolean;
} = {}): DictationHarness {
  const source = readFileSync(new URL("../public/screen-review.jsx", import.meta.url), "utf8");
  const start = source.indexOf("function useDictation");
  const end = source.indexOf("function CommentaryBox");
  if (start === -1 || end === -1) throw new Error("Could not locate useDictation source.");
  const executableSource = `${source.slice(start, end)}
return useDictation;`;

  const states: unknown[] = [];
  const effects: Array<() => void> = [];
  const refs: Array<{ current: unknown }> = [];
  let stateIndex = 0;
  let refIndex = 0;
  const React = {
    useRef(initial: unknown) {
      const index = refIndex++;
      if (!refs[index]) refs[index] = { current: initial };
      return refs[index];
    },
    useState(initial: unknown) {
      const index = stateIndex++;
      states[index] = initial;
      return [states[index], (next: unknown) => { states[index] = next; }] as const;
    },
    useEffect(callback: () => () => void) {
      effects.push(callback());
    },
  };
  const recognition: DictationHarness["recognition"] = { current: null };
  class Recognition {
    continuous?: boolean;
    interimResults?: boolean;
    lang?: string;
    onresult?: (event: RecognitionResultEvent) => void;
    onerror?: () => void;
    onend?: () => void;
    start = vi.fn(() => {
      if (startThrows) throw new Error("permission denied");
    });
    stop = vi.fn();
    constructor() {
      recognition.current = this;
    }
  }
  const window = recognitionAvailable ? { SpeechRecognition: Recognition } : {};
  const useDictation = new Function("React", "window", executableSource)(React, window) as (
    getBase: () => string,
    onText: (text: string) => void,
    onDone: () => void,
  ) => DictationHarness["hook"];
  const onText = vi.fn();
  const onDone = vi.fn();
  const hook = useDictation(() => base, onText, onDone);
  return {
    cleanup: () => effects.forEach((effect) => effect()),
    hook,
    onDone,
    onText,
    recognition,
    state: () => ({ listening: states[0], msg: states[1] }),
  };
}

describe("review workspace UI wiring", () => {
  it("surfaces readable review route errors in the draft tab", () => {
    const app = readFileSync(new URL("../public/app.jsx", import.meta.url), "utf8");
    const workspace = readFileSync(new URL("../public/screen-workspace.jsx", import.meta.url), "utf8");

    expect(app).toContain("const [reviewError, setReviewError]");
    expect(app).toContain("setReviewError(\"\")");
    expect(app).toContain("const body = await r.json().catch(() => null)");
    expect(app).toContain("body.error || body.message");
    expect(app).toContain("reviewError={reviewError}");
    expect(workspace).toContain("function DraftTab({ piece, running, gateStatus, reviewError");
    expect(workspace).toContain("role=\"alert\"");
    expect(workspace).toContain("{reviewError}");
  });

  it("persists author direction and gate commentary for revision guidance", () => {
    const review = readFileSync(new URL("../public/screen-review.jsx", import.meta.url), "utf8");
    const store = readFileSync(new URL("../public/store.js", import.meta.url), "utf8");
    const revision = readFileSync(new URL("../lib/revision.ts", import.meta.url), "utf8");

    expect(review).toContain("function DirectionBox({ piece })");
    expect(review).toContain("window.Store.updatePiece(piece.id, { direction: valRef.current.trim() })");
    expect(review).toContain("function CommentaryBox({ piece, gateId })");
    expect(review).toContain("window.Store.updatePiece(piece.id, { gateNotes: Object.assign({}, piece.gateNotes || {}, { [gateId]: v }) })");
    expect(review).toContain("MicButton listening={dict.listening}");
    expect(store).toContain("\"direction\"");
    expect(store).toContain("\"gateNotes\"");
    expect(revision).toContain("AUTHOR'S CREATIVE DIRECTION");
    expect(revision).toContain("AUTHOR COMMENTARY BY REVIEW SECTION");
    expect(revision).toContain("buildGuidance(piece)");
  });

  it("wires review dictation for commentary and direction controls", () => {
    const review = readFileSync(new URL("../public/screen-review.jsx", import.meta.url), "utf8");

    expect(review).toContain("function useDictation(getBase, onText, onDone)");
    expect(review).toContain("window.SpeechRecognition || window.webkitSpeechRecognition");
    expect(review).toContain("title=\"Dictate commentary\"");
    expect(review).toContain("title=\"Dictate direction\"");
  });

  it("assembles final and interim dictation text with spacing and persists on end", () => {
    const harness = createDictationHarness();

    harness.hook.toggle();

    expect(harness.recognition.current).toMatchObject({
      continuous: true,
      interimResults: true,
      lang: "en-US",
    });
    expect(harness.recognition.current?.start).toHaveBeenCalledTimes(1);
    expect(harness.state()).toMatchObject({ listening: true, msg: null });

    harness.recognition.current?.onresult?.({
      resultIndex: 0,
      results: [
        { 0: { transcript: " first final " }, isFinal: true },
        { 0: { transcript: " second final " }, isFinal: true },
        { 0: { transcript: " still speaking " }, isFinal: false },
      ],
    });

    expect(harness.onText).toHaveBeenLastCalledWith("Existing note first final second final still speaking");

    harness.recognition.current?.onend?.();
    expect(harness.state().listening).toBe(false);
    expect(harness.onDone).toHaveBeenCalledTimes(1);
  });

  it("reports unsupported or failed dictation starts without leaving stale recorder state", () => {
    const unsupported = createDictationHarness({ recognitionAvailable: false });
    unsupported.hook.toggle();
    expect(unsupported.state().msg).toBe("Voice dictation isn't supported in this browser.");

    const failed = createDictationHarness({ startThrows: true });
    failed.hook.toggle();
    expect(failed.state()).toMatchObject({ listening: false, msg: "Dictation could not start." });

    failed.cleanup();
    expect(failed.recognition.current?.stop).not.toHaveBeenCalled();
  });
});
