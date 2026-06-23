import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

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
});
