import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

function createOutputsTabHarness(piece: Record<string, any>, options: {
  generateError?: Error;
  generateResult?: { outputs: Record<string, unknown>; order: string[] };
} = {}) {
  const source = readFileSync(new URL("../public/screen-outputs.jsx", import.meta.url), "utf8");
  const start = source.indexOf("function OutputsTab");
  const end = source.indexOf("\n  if (!piece.original");
  const defaults = source.match(/const PLAT_AUD_DEFAULT = .*?;\n/s)?.[0];
  if (!defaults || start === -1 || end === -1) throw new Error("Could not locate OutputsTab setup source.");
  const executableSource = `${defaults}
${source.slice(start, end)}
  return {
    active,
    auds,
    generate,
    onCondensed,
    orderedActive,
    state: () => ({ busy: __states[2], prog: __states[3], err: __states[4], driveOpen: __states[5], msg: __states[6] }),
    toggle
  };
}
return OutputsTab;`;

  const states: unknown[] = [];
  let stateIndex = 0;
  const React = {
    useState(initial: unknown) {
      const index = stateIndex++;
      states[index] = initial;
      return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(states[index]) : next; }] as const;
    },
  };
  const platforms = [
    { id: "substack", name: "Substack", register: "builders" },
    { id: "facebook", name: "Facebook", register: "relational" },
    { id: "instagram", name: "Instagram", register: "visual" },
  ];
  const window = {
    useIsMobile: () => false,
    GEN: {
      PLATFORMS: platforms,
      AUDIENCE_PRESETS: [{ id: "builders", name: "Builders" }, { id: "relational", name: "Relational" }],
      resolveSources: vi.fn(() => ({})),
      generateOutputs: vi.fn(async (_piece: unknown, active: string[], _auds: unknown, _refCtx: string, onProgress: (id: string, status: string) => void) => {
        active.forEach((id) => onProgress(id, "running"));
        if (options.generateError) throw options.generateError;
        active.forEach((id) => onProgress(id, "done"));
        return options.generateResult || {
          outputs: {
            substack: { platform: "Substack", draftPost: "Substack post" },
            facebook: { platform: "Facebook", draftPost: "Facebook post" },
          },
          order: active,
        };
      }),
    },
  };
  const onUpdate = vi.fn();
  const OutputsTab = new Function("React", "window", "__states", executableSource)(
    React,
    window,
    states,
  ) as (props: Record<string, unknown>) => {
    active: string[];
    auds: Record<string, string>;
    generate: () => Promise<void>;
    onCondensed: (platform: string, draftPost: string) => void;
    orderedActive: string[];
    state: () => { busy: unknown; prog: unknown; err: unknown; driveOpen: unknown; msg: unknown };
    toggle: (id: string) => void;
  };
  const component = OutputsTab({ piece, onUpdate, refCtx: "Reference context", onGoStudio: vi.fn() });
  return { component, onUpdate, window };
}

describe("outputs tab UI wiring", () => {
  it("executes platform generation and persists output settings", async () => {
    const piece = { id: "piece-a", original: "Draft text", outputs: {}, outputOrder: [] };
    const harness = createOutputsTabHarness(piece);

    await harness.component.generate();

    expect(harness.window.GEN.generateOutputs).toHaveBeenCalledWith(
      piece,
      ["substack", "facebook"],
      expect.objectContaining({ substack: "builders", facebook: "relational" }),
      "Reference context",
      expect.any(Function),
    );
    expect(harness.onUpdate).toHaveBeenCalledWith({
      outputs: {
        substack: { platform: "Substack", draftPost: "Substack post" },
        facebook: { platform: "Facebook", draftPost: "Facebook post" },
      },
      outputOrder: ["substack", "facebook"],
      outputSettings: {
        active: ["substack", "facebook"],
        audiences: expect.objectContaining({ substack: "builders", facebook: "relational" }),
      },
    });
    expect(harness.component.state()).toMatchObject({
      busy: false,
      err: null,
      prog: { substack: "done", facebook: "done" },
    });
  });

  it("records readable output generation failures and leaves outputs untouched", async () => {
    const harness = createOutputsTabHarness(
      { id: "piece-a", original: "Draft text", outputs: {}, outputOrder: [] },
      { generateError: new Error("Reconnect the outputs model.") },
    );

    await harness.component.generate();

    expect(harness.onUpdate).not.toHaveBeenCalled();
    expect(harness.component.state()).toMatchObject({
      busy: false,
      err: "Reconnect the outputs model.",
      prog: { substack: "running", facebook: "running" },
    });
  });

  it("applies condensed output text without replacing other platform outputs", () => {
    const harness = createOutputsTabHarness({
      id: "piece-a",
      original: "Draft text",
      outputs: {
        substack: { platform: "Substack", draftPost: "Long post", hooks: ["Keep"] },
        facebook: { platform: "Facebook", draftPost: "Other post" },
      },
      outputOrder: ["substack", "facebook"],
    });

    harness.component.onCondensed("substack", "Short post");

    expect(harness.onUpdate).toHaveBeenCalledWith({
      outputs: {
        substack: { platform: "Substack", draftPost: "Short post", hooks: ["Keep"] },
        facebook: { platform: "Facebook", draftPost: "Other post" },
      },
    });
  });
});
