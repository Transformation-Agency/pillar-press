import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  checkReleaseReadiness,
  hasExplicitWaiverNote,
  isNonBlockingRow,
  releaseVerificationGuidance,
  WAIVED_STATUS,
  type TrackerRow,
} from "@/scripts/check-release-readiness";

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
    expect(output).toContain("KINGS_PRESS_LIVE_OPENAI_API_KEY");
    expect(output).toContain("KINGS_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS=yes");
    expect(output).not.toContain("- AUDIO-001");
    expect(output).not.toContain("AUTH-001 (");
  });

  it("prints specific live-provider verification guidance for release blockers", () => {
    expect(releaseVerificationGuidance({ storyId: "PROV-004" }).join("\n")).toContain("KINGS_PRESS_LIVE_OPENAI_API_KEY");
    expect(releaseVerificationGuidance({ storyId: "MEDIA-002" }).join("\n")).toContain("KINGS_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS=yes");
    expect(releaseVerificationGuidance({ storyId: "MEDIA-002" }).join("\n")).toContain("KINGS_PRESS_LIVE_XAI_API_KEY");
    expect(releaseVerificationGuidance({ storyId: "MEDIA-002" }).join("\n")).toContain("KINGS_PRESS_LIVE_HEDRA_API_KEY");
    expect(releaseVerificationGuidance({ storyId: "AUDIO-001" })).toEqual([]);
  });

  it("requires explicit WAIVER evidence before a waived row can unblock release", () => {
    expect(isNonBlockingRow({
      testStatus: WAIVED_STATUS,
      testEvidence: "",
      errorsFound: "Provider-key QA skipped.",
    })).toBe(false);

    expect(isNonBlockingRow({
      testStatus: WAIVED_STATUS,
      testEvidence: "WAIVER: Paul approved release on 2026-06-23 for the exact scope of shipping without live provider-credit generation.",
      errorsFound: "Provider-key QA skipped.",
    })).toBe(true);
  });

  it("rejects vague waiver notes without owner date and release scope", () => {
    expect(hasExplicitWaiverNote({
      testEvidence: "WAIVER: explicit owner waiver.",
      errorsFound: "",
    })).toBe(false);
    expect(hasExplicitWaiverNote({
      testEvidence: "WAIVER: Paul approved release on 2026-06-23 for the exact scope of MEDIA-002 live Hedra video generation.",
      errorsFound: "",
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
      { ...base, row: 4, storyId: "PROV-004", testStatus: WAIVED_STATUS, testEvidence: "WAIVER: Paul approved release on 2026-06-23 for the exact scope of OpenAI live model verification." },
    ] satisfies TrackerRow[]);

    expect(result.blocking.map((row) => row.storyId)).toEqual(["AUDIO-001"]);
  });
});
