import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "kings-press-prefs-theme-"));
  process.env.KINGS_PRESS_DATA_DIR = dir;
  process.env.KINGS_PRESS_LOCAL_FIRST = "true";
  delete process.env.DEFAULT_USER_ID;
});

afterEach(async () => {
  const { resetLocalDbForTests } = await import("@/lib/local/database");
  resetLocalDbForTests();
  delete process.env.KINGS_PRESS_DATA_DIR;
  delete process.env.KINGS_PRESS_LOCAL_FIRST;
  delete process.env.DEFAULT_USER_ID;
  rmSync(dir, { recursive: true, force: true });
});

describe("preferences theme and tweaks", () => {
  it("persists non-secret theme and tweak preferences through the local settings route", async () => {
    const settingsRoute = await import("../app/api/settings/route");

    const initial = await settingsRoute.GET();
    const initialBody = await initial.json();
    expect(initial.status).toBe(200);
    expect(initialBody.settings).toMatchObject({
      driveFolderId: null,
      prefs: {},
      driveLinked: false,
    });

    const put = await settingsRoute.PUT(new Request("http://test.local/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        prefs: {
          theme: "dark",
          role: "author",
          activeCampaignId: "camp_theme",
          typeface: "Quiet",
          readingSize: 18.5,
          accent: "oklch(0.480 0.080 150)",
        },
      }),
    }));
    const putBody = await put.json();

    expect(put.status).toBe(200);
    expect(putBody.settings).toMatchObject({
      driveFolderId: null,
      driveLinked: false,
      prefs: {
        theme: "dark",
        role: "author",
        activeCampaignId: "camp_theme",
        typeface: "Quiet",
        readingSize: 18.5,
        accent: "oklch(0.480 0.080 150)",
      },
    });
    expect(JSON.stringify(putBody)).not.toMatch(/refresh|token|apiKey|secret/i);

    const reloaded = await settingsRoute.GET();
    const reloadedBody = await reloaded.json();
    expect(reloadedBody.settings.prefs).toMatchObject(putBody.settings.prefs);
  });

  it("rejects invalid theme values before they reach settings persistence", async () => {
    const settingsRoute = await import("../app/api/settings/route");

    const res = await settingsRoute.PUT(new Request("http://test.local/api/settings", {
      method: "PUT",
      body: JSON.stringify({ prefs: { theme: "sepia" } }),
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({ code: "bad_request" });
  });

  it("wires the topbar theme toggle and runtime Tweaks layer to Store preferences", () => {
    const app = readFileSync(new URL("../public/app.jsx", import.meta.url), "utf8");
    const store = readFileSync(new URL("../public/store.js", import.meta.url), "utf8");
    const tweaks = readFileSync(new URL("../public/tweaks-panel.jsx", import.meta.url), "utf8");
    const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

    expect(index).toContain('<script type="text/babel" src="tweaks-panel.jsx"></script>');
    expect(app).toContain('const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/');
    expect(app).toContain('function TweaksLayer({ theme })');
    expect(app).toContain('const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS)');
    expect(app).toContain('window.Store.toggleTheme()');
    expect(app).toContain('title="Toggle light / dark"');
    expect(app).toContain('<TweaksLayer theme={state.theme} />');
    expect(app).toContain('root.style.setProperty("--font-display", f.display)');
    expect(app).toContain('document.documentElement.style.setProperty("--accent", v)');
    expect(app).toContain('document.body.style.fontSize = (t.readingSize || 17.5) + "px"');
    expect(app).toContain('<window.TweakRadio label="Pairing"');
    expect(app).toContain('<window.TweakSlider label="Reading size"');
    expect(app).toContain('<window.TweakColor label="House color"');

    expect(store).toContain('if (prefs.theme === "light" || prefs.theme === "dark") state.theme = prefs.theme');
    expect(store).toContain('document.documentElement.setAttribute("data-theme", state.theme || "light")');
    expect(store).toContain('setTheme(t) { state.theme = t; document.documentElement.setAttribute("data-theme", t); emit(); persistPrefs(); }');
    expect(store).toContain('toggleTheme() { api.setTheme(state.theme === "dark" ? "light" : "dark"); }');
    expect(store).toContain('bg(apiSend("PUT", "/settings", { prefs }), "PUT /settings")');

    expect(tweaks).toContain("Object.assign(window, {");
    expect(tweaks).toContain("useTweaks");
    expect(tweaks).toContain("TweaksPanel");
    expect(tweaks).toContain("TweakSlider");
    expect(tweaks).toContain("TweakRadio");
    expect(tweaks).toContain("TweakColor");
  });
});
