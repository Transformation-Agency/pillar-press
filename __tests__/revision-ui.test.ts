import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

function createRevisionTabHarness(piece: Record<string, unknown>, options: {
  generateResult?: Record<string, unknown>;
  generateError?: Error;
  statusResult?: Record<string, unknown>;
} = {}) {
  const source = readFileSync(new URL("../public/screen-revision.jsx", import.meta.url), "utf8");
  const start = source.indexOf("function RevisionTab");
  const end = source.indexOf("  const busyLabel");
  if (start === -1 || end === -1) throw new Error("Could not locate RevisionTab setup source.");
  const executableSource = `${source.slice(start, end)}
  return { acceptRevision, accepted, generate, generateState: () => ({ busy: __states[0], prog: __states[1], err: __states[2], mode: __states[3], full: __states[4] }) };
}
return RevisionTab;`;

  const states: unknown[] = [];
  let stateIndex = 0;
  const React = {
    useState(initial: unknown) {
      const index = stateIndex++;
      states[index] = initial;
      return [states[index], (next: unknown) => { states[index] = next; }] as const;
    },
  };
  const window = {
    useIsMobile: () => false,
    GEN: {
      generateRevision: vi.fn(async () => {
        if (options.generateError) throw options.generateError;
        return options.generateResult || {
          revision: "Generated revision",
          changelog: [{ finding: "C1", change: "Clarified the opening" }],
          trace: { plan: "light_polish", status: "complete" },
          status: "complete",
        };
      }),
    },
  };
  const onUpdate = vi.fn();
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => options.statusResult || { done: true, running: false },
  }));
  const setTimeout = vi.fn((fn: () => void) => {
    fn();
    return 1;
  });
  const RevisionTab = new Function("React", "window", "fetch", "setTimeout", "__states", executableSource)(
    React,
    window,
    fetch,
    setTimeout,
    states,
  ) as (props: Record<string, unknown>) => {
    acceptRevision: () => void;
    accepted: boolean;
    generate: () => Promise<void>;
    generateState: () => Record<string, unknown>;
  };
  const component = RevisionTab({ piece, onUpdate, refCtx: "Reference context" });
  return { component, fetch, onUpdate, setTimeout, window };
}

describe("revision tab UI wiring", () => {
  it("offers accept revision and keeps trace/changelog while moving text into the draft", () => {
    const source = readFileSync(new URL("../public/screen-revision.jsx", import.meta.url), "utf8");

    expect(source).toContain("const acceptRevision = () =>");
    expect(source).toContain("const patch = { original: rev.text }");
    expect(source).toContain("patch.status = \"Revised\"");
    expect(source).toContain("Accept revision");
    expect(source).toContain("Accepted into draft");
    expect(source).not.toContain("revision: null");
  });

  it("executes accept revision without clearing revision metadata", () => {
    const revision = {
      text: "Revised draft",
      changelog: [{ finding: "DIR", change: "Followed direction" }],
      trace: { plan: "light_polish" },
    };
    const harness = createRevisionTabHarness({
      id: "piece-a",
      status: "Reviewed",
      original: "Original draft",
      packet: { clarity: { findings: [] } },
      revision,
    });

    harness.component.acceptRevision();

    expect(harness.onUpdate).toHaveBeenCalledWith({ original: "Revised draft", status: "Revised" });
    expect(harness.onUpdate.mock.calls[0][0]).not.toHaveProperty("revision");

    const acceptedHarness = createRevisionTabHarness({
      id: "piece-a",
      status: "Revised",
      original: "Revised draft",
      packet: { clarity: { findings: [] } },
      revision,
    });
    acceptedHarness.component.acceptRevision();

    expect(acceptedHarness.component.accepted).toBe(true);
    expect(acceptedHarness.onUpdate).not.toHaveBeenCalled();
  });

  it("executes generate revision and preserves readable failures", async () => {
    const harness = createRevisionTabHarness({
      id: "piece-a",
      status: "Reviewed",
      original: "Original draft",
      packet: { clarity: { findings: [] } },
      revision: null,
    });

    await harness.component.generate();

    expect(harness.window.GEN.generateRevision).toHaveBeenCalledWith(
      expect.objectContaining({ id: "piece-a" }),
      "Reference context",
      expect.any(Function),
      { mode: "light" },
    );
    expect(harness.fetch).toHaveBeenCalledWith("/api/pieces/piece-a/revision/status", { headers: { Accept: "application/json" } });
    expect(harness.onUpdate).toHaveBeenCalledWith({
      revision: {
        text: "Generated revision",
        changelog: [{ finding: "C1", change: "Clarified the opening" }],
        trace: { plan: "light_polish", status: "complete" },
        status: "complete",
      },
      status: "Revised",
    });
    expect(harness.component.generateState()).toMatchObject({ busy: false, prog: null, err: null });

    const failed = createRevisionTabHarness({
      id: "piece-b",
      status: "Reviewed",
      original: "Original draft",
      packet: { clarity: { findings: [] } },
      revision: null,
    }, { generateError: new Error("Provider unavailable") });

    await failed.component.generate();

    expect(failed.onUpdate).not.toHaveBeenCalled();
    expect(failed.component.generateState()).toMatchObject({ busy: false, prog: null, err: "Provider unavailable" });
  });
});
