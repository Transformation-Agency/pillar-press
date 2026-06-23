import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { checkReleaseReadiness, isNonBlockingRow, WAIVED_STATUS, type TrackerRow } from "@/scripts/check-release-readiness";

describe("desktop release readiness gate", () => {
  it("fails closed on the current unwaived tracker blockers", () => {
    let output = "";
    let exitCode = 0;
    try {
      output = execFileSync("npx", ["tsx", "scripts/check-release-readiness.ts"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      const err = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
      exitCode = err.status ?? 1;
      output = `${err.stdout?.toString() ?? ""}${err.stderr?.toString() ?? ""}`;
    }

    expect(exitCode).toBe(1);
    expect(output).toContain("totalStories");
    expect(output).toContain("PROV-004");
    expect(output).toContain("MEDIA-002");
    expect(output).toContain("AUDIO-001");
    expect(output).not.toContain("AUTH-001 (");
  });

  it("requires explicit WAIVER evidence before a waived row can unblock release", () => {
    expect(isNonBlockingRow({
      testStatus: WAIVED_STATUS,
      testEvidence: "",
      errorsFound: "Provider-key QA skipped.",
    })).toBe(false);

    expect(isNonBlockingRow({
      testStatus: WAIVED_STATUS,
      testEvidence: "WAIVER: Paul approved shipping without live provider-credit generation on 2026-06-23.",
      errorsFound: "Provider-key QA skipped.",
    })).toBe(true);
  });

  it("reports waived rows without explicit waiver notes as blockers", () => {
    const base = {
      row: 2,
      storyId: "MEDIA-002",
      featureArea: "Studio",
      feature: "Generate media",
      evidenceStatus: "Manual waiver",
      priority: "Critical",
      errorsFound: "",
    };
    const result = checkReleaseReadiness([
      { ...base, testStatus: "Retest passed", testEvidence: "" },
      { ...base, row: 3, storyId: "AUDIO-001", testStatus: WAIVED_STATUS, testEvidence: "" },
      { ...base, row: 4, storyId: "PROV-004", testStatus: WAIVED_STATUS, testEvidence: "WAIVER: explicit owner waiver." },
    ] satisfies TrackerRow[]);

    expect(result.blocking.map((row) => row.storyId)).toEqual(["AUDIO-001"]);
  });
});
