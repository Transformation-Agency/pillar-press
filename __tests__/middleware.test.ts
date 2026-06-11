import { describe, expect, it } from "vitest";
import { isSiteBasicAuthAuthorized } from "@/middleware";

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
});
