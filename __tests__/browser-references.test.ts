import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

function createRefsAIModalHarness(options: {
  fetchResponse?: { ok: boolean; status?: number; body: Record<string, any> };
  extractError?: Error;
} = {}) {
  const source = readFileSync(new URL("../public/screen-references.jsx", import.meta.url), "utf8");
  const start = source.indexOf("function RefsAIModal");
  const end = source.indexOf("\n  return (", start);
  if (start === -1 || end === -1) throw new Error("Could not locate RefsAIModal setup source.");
  const executableSource = `${source.slice(start, end)}
  return {
    apply,
    attach,
    generate,
    setInstruction,
    state: () => ({
      instruction: __states[0],
      busy: __states[1],
      err: __states[2],
      result: __states[3],
      uploading: __states[4],
      attached: __states[5],
    }),
  };
}
return RefsAIModal;`;

  const states: unknown[] = [];
  let stateIndex = 0;
  const React = {
    useState(initial: unknown) {
      const index = stateIndex++;
      if (states[index] === undefined) states[index] = initial;
      return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(states[index]) : next; }] as const;
    },
    useRef(initial: unknown) {
      return { current: initial };
    },
  };
  const response = options.fetchResponse || {
    ok: true,
    body: {
      summary: "Added skeptical executives.",
      doc: {
        strategy: { body: "Sharper strategy." },
        redLines: { rules: ["Do not overclaim."] },
      },
    },
  };
  const fetch = vi.fn(async () => ({
    ok: response.ok,
    status: response.status || (response.ok ? 200 : 500),
    json: async () => response.body,
  }));
  const window = {
    UPLOAD_ACCEPT: ".txt,.md,.pdf,.docx",
    extractFileText: vi.fn(async (file: any) => {
      if (options.extractError) throw options.extractError;
      return `Extracted text from ${file.name}`;
    }),
  };
  const onClose = vi.fn();
  const onApply = vi.fn();
  const RefsAIModal = new Function("React", "window", "fetch", "__states", executableSource)(
    React,
    window,
    fetch,
    states,
  ) as (props: Record<string, unknown>) => {
    apply: () => void;
    attach: (event: Record<string, any>) => Promise<void>;
    generate: () => Promise<void>;
    setInstruction: (value: string) => void;
    state: () => Record<string, unknown>;
  };
  const render = () => {
    stateIndex = 0;
    return RefsAIModal({ campaignId: "campaign-1", onClose, onApply });
  };
  return { fetch, onApply, onClose, render, window };
}

describe("browser References AI edit modal", () => {
  it("executes generate/apply without persisting until the author accepts", async () => {
    const harness = createRefsAIModalHarness();
    let modal = harness.render();
    modal.setInstruction("  Add an audience for skeptical executives.  ");
    modal = harness.render();

    await modal.generate();

    expect(harness.fetch).toHaveBeenCalledWith(
      "/api/campaigns/campaign-1/references/ai-edit",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({ "Content-Type": "application/json", Accept: "application/json" }),
        body: JSON.stringify({ instruction: "Add an audience for skeptical executives." }),
      }),
    );
    expect(harness.onApply).not.toHaveBeenCalled();
    expect(harness.onClose).not.toHaveBeenCalled();
    expect(modal.state()).toMatchObject({
      busy: false,
      err: null,
      result: {
        summary: "Added skeptical executives.",
        doc: {
          strategy: { body: "Sharper strategy." },
          redLines: { rules: ["Do not overclaim."] },
        },
      },
    });

    modal = harness.render();
    modal.apply();

    expect(harness.onApply).toHaveBeenCalledWith({
      strategy: { body: "Sharper strategy." },
      redLines: { rules: ["Do not overclaim."] },
    });
    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  it("surfaces readable generation errors without applying a stale document", async () => {
    const harness = createRefsAIModalHarness({
      fetchResponse: { ok: false, status: 403, body: { error: "Switch to Author to edit Preferences." } },
    });
    let modal = harness.render();
    modal.setInstruction("Add a red line.");
    modal = harness.render();

    await modal.generate();

    expect(modal.state()).toMatchObject({
      busy: false,
      err: "Switch to Author to edit Preferences.",
      result: null,
    });
    expect(harness.onApply).not.toHaveBeenCalled();
    expect(harness.onClose).not.toHaveBeenCalled();
  });

  it("attaches extracted source material to the plain-language instruction", async () => {
    const harness = createRefsAIModalHarness();
    const modal = harness.render();
    const event = {
      target: {
        files: [{ name: "brand-notes.txt" }],
        value: "brand-notes.txt",
      },
    };

    await modal.attach(event);

    expect(harness.window.extractFileText).toHaveBeenCalledWith({ name: "brand-notes.txt" });
    expect(event.target.value).toBe("");
    expect(modal.state()).toMatchObject({
      uploading: false,
      attached: ["brand-notes.txt"],
    });
    expect(String(modal.state().instruction)).toContain('Source material from "brand-notes.txt"');
    expect(String(modal.state().instruction)).toContain("Extracted text from brand-notes.txt");
  });
});
