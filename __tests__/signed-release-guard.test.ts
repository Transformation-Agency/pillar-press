import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("signed desktop release guard", () => {
  it("runs tracker release-readiness before Apple signing credentials are evaluated", () => {
    const source = readFileSync(join(process.cwd(), "scripts", "build-signed-desktop.ts"), "utf8");
    const readinessCall = source.indexOf("await assertReleaseReadiness();");
    const signingIdentity = source.indexOf("const signingIdentity");
    const notaryCredentials = source.indexOf("Missing Apple notarization credentials.");

    expect(readinessCall).toBeGreaterThan(-1);
    expect(readinessCall).toBeLessThan(signingIdentity);
    expect(readinessCall).toBeLessThan(notaryCredentials);
    expect(source).toContain("npm\", [\"run\", \"desktop:release-readiness\"]");
  });
});
