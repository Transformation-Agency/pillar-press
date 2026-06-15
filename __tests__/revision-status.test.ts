import { describe, expect, it } from "vitest";
import {
  failRevisionProgress,
  finishRevisionProgress,
  getRevisionProgress,
  startRevisionProgress,
  updateRevisionProgress,
} from "@/lib/revisionStatus";

describe("revision progress", () => {
  it("tracks a revision run from progress to done", () => {
    startRevisionProgress("piece-a", "run-a", "full");
    updateRevisionProgress("piece-a", "run-a", 2, 5);

    expect(getRevisionProgress("piece-a", "run-a")).toMatchObject({
      pieceId: "piece-a",
      runId: "run-a",
      mode: "full",
      status: "running",
      done: 2,
      total: 5,
    });

    finishRevisionProgress("piece-a", "run-a", {
      text: "Revised draft",
      changelog: [{ finding: "C1", change: "Tightened opening.", note: "" }],
    });

    expect(getRevisionProgress("piece-a", "run-a")).toMatchObject({
      status: "done",
      done: 5,
      total: 5,
      revision: { text: "Revised draft" },
    });
  });

  it("records failed revision runs", () => {
    startRevisionProgress("piece-b", "run-b", "light");
    failRevisionProgress("piece-b", "run-b", "Provider failed.");

    expect(getRevisionProgress("piece-b", "run-b")).toMatchObject({
      status: "error",
      message: "Provider failed.",
    });
  });
});
