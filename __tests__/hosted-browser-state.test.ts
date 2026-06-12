import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readPublic(name: string) {
  return readFileSync(join(root, "public", name), "utf8");
}

describe("hosted browser account state isolation", () => {
  it("clears the REST-backed Store cache before reload and when auth is absent", () => {
    const store = readPublic("store.js");

    expect(store).toContain("function resetState");
    expect(store).toContain("state = defaultState()");
    expect(store).toContain("loadedCampaigns.clear()");
    expect(store).toContain("pendingCampaignCreates.clear()");
    expect(store).toContain("if (auth && auth.requiresLogin && !auth.authenticated)");
    expect(store).toContain("resetState();");
    expect(store).toContain("reload() { resetState(); return hydrate(); }");
    expect(store).toContain("resetForAuth() { resetState(); }");
  });

  it("wipes Store state after hosted sign-out", () => {
    const app = readPublic("app.jsx");

    expect(app).toContain("const signOutHosted = async () =>");
    expect(app).toContain("await window.KP_AUTH.signOut()");
    expect(app).toContain("window.Store.resetForAuth()");
    expect(app).toContain("onClick={signOutHosted}");
  });
});
