import { describe, expect, it } from "vitest";
import { isSiteBasicAuthAuthorized, isSiteBasicAuthEnabled } from "@/middleware";

function basic(user: string, password: string) {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

describe("hosted site basic auth", () => {
  it("allows the current and legacy default usernames when only a password is configured", () => {
    expect(isSiteBasicAuthAuthorized(basic("king", "secret"), "secret")).toBe(true);
    expect(isSiteBasicAuthAuthorized(basic("pillar", "secret"), "secret")).toBe(true);
    expect(isSiteBasicAuthAuthorized(basic("paul", "secret"), "secret")).toBe(false);
  });

  it("honors an explicit hosted username allow-list", () => {
    expect(isSiteBasicAuthAuthorized(basic("paul", "secret"), "secret", ["paul", "editor"])).toBe(true);
    expect(isSiteBasicAuthAuthorized(basic("editor", "secret"), "secret", ["paul", "editor"])).toBe(true);
    expect(isSiteBasicAuthAuthorized(basic("king", "secret"), "secret", ["paul", "editor"])).toBe(false);
  });

  it("rejects missing or wrong credentials", () => {
    expect(isSiteBasicAuthAuthorized(null, "secret")).toBe(false);
    expect(isSiteBasicAuthAuthorized(basic("king", "wrong"), "secret")).toBe(false);
  });

  it("does not enable Basic Auth in hosted SaaS mode when account auth is active", () => {
    expect(isSiteBasicAuthEnabled({
      SITE_PASSWORD: "secret",
      PILLAR_PRESS_HOSTED_WEB: "true",
      AUTH_DISABLED: "false",
    })).toBe(false);
    expect(isSiteBasicAuthEnabled({
      SITE_PASSWORD: "secret",
      PILLAR_PRESS_RUNTIME: "hosted",
    })).toBe(false);
  });

  it("allows Basic Auth for explicit hosted private previews", () => {
    expect(isSiteBasicAuthEnabled({
      SITE_PASSWORD: "secret",
      PILLAR_PRESS_HOSTED_WEB: "true",
      AUTH_DISABLED: "true",
    })).toBe(true);
  });

  it("allows Basic Auth outside hosted SaaS mode when configured", () => {
    expect(isSiteBasicAuthEnabled({
      SITE_PASSWORD: "secret",
    })).toBe(true);
    expect(isSiteBasicAuthEnabled({})).toBe(false);
  });
});
