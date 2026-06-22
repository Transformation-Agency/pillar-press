import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

function createRevisionTabHarness(piece: Record<string, unknown>) {
  const source = readFileSync(new URL("../public/screen-revision.jsx", import.meta.url), "utf8");
  const start = source.indexOf("function RevisionTab");
  const end = source.indexOf("  const busyLabel");
  if (start === -1 || end === -1) throw new Error("Could not locate RevisionTab setup source.");
  const executableSource = `${source.slice(start, end)}
  return { acceptRevision, accepted, generateState: () => ({ busy, prog, err, mode, full }) };
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
  const window = { useIsMobile: () => false };
  const onUpdate = vi.fn();
  const RevisionTab = new Function("React", "window", "fetch", "setTimeout", executableSource)(
    React,
    window,
    vi.fn(),
    vi.fn(),
  ) as (props: Record<string, unknown>) => { acceptRevision: () => void; accepted: boolean };
  const component = RevisionTab({ piece, onUpdate, refCtx: "Reference context" });
  return { component, onUpdate };
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
});
