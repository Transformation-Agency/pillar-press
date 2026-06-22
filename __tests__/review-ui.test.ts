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

type ReviewComponentHarness = {
  component: Record<string, unknown>;
  store: { updatePiece: ReturnType<typeof vi.fn> };
};

function createPacketTextHarness() {
  const source = readFileSync(new URL("../public/screen-review.jsx", import.meta.url), "utf8");
  const start = source.indexOf("function packetToText");
  const end = source.indexOf("function ReviewTraceStrip");
  if (start === -1 || end === -1) throw new Error("Could not locate packet text helpers.");
  const executableSource = `${source.slice(start, end)}
return { packetToText, gateSectionToText };`;
  const gates = [
    { id: "strategy", n: 1, name: "Strategy" },
    { id: "audience", n: 2, name: "Audience" },
    { id: "tone", n: 3, name: "Tone" },
    { id: "rigor", n: 4, name: "Rigor" },
    { id: "stress", n: 5, name: "Stress" },
    { id: "clarity", n: 6, name: "Clarity" },
    { id: "self", n: 7, name: "Self" },
  ];
  const window = {
    GATES: gates,
    SEVERITY: {
      must: { label: "Must fix" },
      consider: { label: "Consider" },
      note: { label: "Note" },
    },
  };
  return {
    gates,
    helpers: new Function("window", executableSource)(window) as {
      packetToText: (piece: Record<string, any>) => string;
      gateSectionToText: (gate: Record<string, any>, result: Record<string, any>) => string;
    },
  };
}

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

function createReviewComponentHarness(kind: "direction" | "commentary", piece: Record<string, unknown>, gateId = "clarity"): ReviewComponentHarness {
  const source = readFileSync(new URL("../public/screen-review.jsx", import.meta.url), "utf8");
  const dictationStart = source.indexOf("function useDictation");
  const commentaryStart = source.indexOf("function CommentaryBox");
  const directionStart = source.indexOf("function DirectionBox");
  const reviewTabStart = source.indexOf("function ReviewTab");
  if (dictationStart === -1 || commentaryStart === -1 || directionStart === -1 || reviewTabStart === -1) {
    throw new Error("Could not locate review component source.");
  }
  const dictationSource = source.slice(dictationStart, commentaryStart);
  const componentSource = kind === "direction"
    ? source.slice(directionStart, reviewTabStart)
    : source.slice(commentaryStart, directionStart);
  const stopAt = kind === "direction" ? componentSource.lastIndexOf("\n  return (") : componentSource.indexOf("\n  if (!open)");
  if (stopAt === -1) throw new Error(`Could not locate ${kind} component JSX return.`);
  const componentName = kind === "direction" ? "DirectionBox" : "CommentaryBox";
  const exposed = kind === "direction"
    ? "return { dict, persist, set, value: () => valRef.current };"
    : "return { dict, open, openAnd, persist, setVal, value: () => valRef.current };";
  const executableSource = `${dictationSource}
${componentSource.slice(0, stopAt)}
  ${exposed}
}
return ${componentName};`;

  const states: unknown[] = [];
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
    useEffect(callback: () => unknown) {
      callback();
    },
  };
  const store = { updatePiece: vi.fn() };
  const window = { Store: store };
  const Component = new Function("React", "window", executableSource)(React, window) as (props: Record<string, unknown>) => Record<string, unknown>;
  const component = kind === "direction" ? Component({ piece }) : Component({ piece, gateId });
  return { component, store };
}

describe("review workspace UI wiring", () => {
  it("exports full review packet text with gate summaries, severity labels, and findings", () => {
    const { gates, helpers } = createPacketTextHarness();
    const piece = {
      title: "Field memo",
      packet: {
        strategy: {
          summary: "Strategy summary.",
          findings: [{ severity: "must", title: "Missing throughline", detail: "Tie it to the core idea." }],
        },
        clarity: {
          summary: "Clarity summary.",
          findings: [{ severity: "consider", title: "Dense paragraph", detail: "Split the setup." }],
        },
        self: {
          summary: "Self summary.",
          findings: [{ severity: "note", title: "Strong voice", detail: "Keep the first-person line." }],
        },
      },
    };

    const packetText = helpers.packetToText(piece);

    expect(packetText).toContain("REVIEW PACKET — Field memo");
    expect(packetText).toContain("1. STRATEGY");
    expect(packetText).toContain("Strategy summary.");
    expect(packetText).toContain("[Must fix] Missing throughline — Tie it to the core idea.");
    expect(packetText).toContain("6. CLARITY");
    expect(packetText).toContain("[Consider] Dense paragraph — Split the setup.");
    expect(packetText).toContain("7. SELF");
    expect(packetText).toContain("[Note] Strong voice — Keep the first-person line.");
    expect(packetText).not.toContain("2. AUDIENCE");

    const clarityText = helpers.gateSectionToText(gates[5], piece.packet.clarity);
    expect(clarityText).toBe("6. CLARITY\nClarity summary.\n  [Consider] Dense paragraph — Split the setup.\n");
  });

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

  it("executes direction and commentary persistence payloads", () => {
    const direction = createReviewComponentHarness("direction", { id: "piece-a", direction: "Old direction" });
    (direction.component.set as (value: string) => void)("  New direction  ");
    (direction.component.persist as () => void)();

    expect(direction.store.updatePiece).toHaveBeenCalledWith("piece-a", { direction: "New direction" });

    const commentary = createReviewComponentHarness("commentary", {
      id: "piece-a",
      gateNotes: { clarity: "Old note", tone: "Keep warm" },
    }, "clarity");
    (commentary.component.setVal as (value: string) => void)("  Sharpen the second paragraph  ");
    (commentary.component.persist as () => void)();

    expect(commentary.store.updatePiece).toHaveBeenCalledWith("piece-a", {
      gateNotes: { clarity: "Sharpen the second paragraph", tone: "Keep warm" },
    });
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
