import { describe, expect, it } from "vitest";
import {
  checkReleaseReadiness,
  hasExplicitWaiverNote,
  isNonBlockingRow,
  releaseVerificationGuidance,
  trackerRows,
  WAIVED_STATUS,
  type TrackerRow,
} from "@/scripts/check-release-readiness";

describe("desktop release readiness gate", () => {
  it("passes on the current tracker when remaining release scope is explicitly waived", () => {
    const result = checkReleaseReadiness(trackerRows());

    expect(result).toMatchObject({ totalStories: expect.any(Number) });
    expect(result.blocking.map((row) => row.storyId)).not.toEqual(expect.arrayContaining([
      "PROV-004",
      "MEDIA-002",
      "AUDIO-001",
      "AUTH-001",
    ]));
  });

  it("prints specific live-provider verification guidance for release blockers", () => {
    expect(releaseVerificationGuidance({ storyId: "PROV-004" }).join("\n")).toContain("PILLAR_PRESS_LIVE_OPENAI_API_KEY");
    expect(releaseVerificationGuidance({ storyId: "MEDIA-002" }).join("\n")).toContain("PILLAR_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS=yes");
    expect(releaseVerificationGuidance({ storyId: "MEDIA-002" }).join("\n")).toContain("PILLAR_PRESS_LIVE_XAI_API_KEY");
    expect(releaseVerificationGuidance({ storyId: "MEDIA-002" }).join("\n")).toContain("PILLAR_PRESS_LIVE_HEDRA_API_KEY");
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
      testEvidence: "WAIVER: Owner approved release on 2026-06-23 for the exact scope of shipping without live provider-credit generation.",
      errorsFound: "Provider-key QA skipped.",
    })).toBe(true);
  });

  it("rejects vague waiver notes without owner date and release scope", () => {
    expect(hasExplicitWaiverNote({
      testEvidence: "WAIVER: explicit owner waiver.",
      errorsFound: "",
    })).toBe(false);
    expect(hasExplicitWaiverNote({
      testEvidence: "WAIVER: Owner approved release on 2026-06-23 for the exact scope of MEDIA-002 live Hedra video generation.",
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
      { ...base, row: 4, storyId: "PROV-004", testStatus: WAIVED_STATUS, testEvidence: "WAIVER: Owner approved release on 2026-06-23 for the exact scope of OpenAI live model verification." },
    ] satisfies TrackerRow[]);

    expect(result.blocking.map((row) => row.storyId)).toEqual(["AUDIO-001"]);
  });
});
