import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const tweaksPanel = () => readFileSync(new URL("../public/tweaks-panel.jsx", import.meta.url), "utf8");
const appShell = () => readFileSync(new URL("../public/app.jsx", import.meta.url), "utf8");
const storeSource = () => readFileSync(new URL("../public/store.js", import.meta.url), "utf8");

describe("browser tweaks panel contract", () => {
  it("publishes tweak edits to the host and same-window listeners", () => {
    const source = tweaksPanel();

    expect(source).toContain("function useTweaks(defaults)");
    expect(source).toContain("const [values, setValues] = React.useState(defaults)");
    expect(source).toContain("const edits = typeof keyOrEdits === 'object' && keyOrEdits !== null");
    expect(source).toContain("setValues((prev) => ({ ...prev, ...edits }))");
    expect(source).toContain("window.parent.postMessage({ type: '__edit_mode_set_keys', edits }, '*')");
    expect(source).toContain("window.dispatchEvent(new CustomEvent('tweakchange', { detail: edits }))");
    expect(source).toContain("return [values, setTweak]");
  });

  it("implements the edit-mode host protocol for activation and dismissal", () => {
    const source = tweaksPanel();

    expect(source).toContain("function TweaksPanel({ title = 'Tweaks', children })");
    expect(source).toContain("if (t === '__activate_edit_mode') setOpen(true)");
    expect(source).toContain("else if (t === '__deactivate_edit_mode') setOpen(false)");
    expect(source).toContain("window.addEventListener('message', onMsg)");
    expect(source).toContain("window.parent.postMessage({ type: '__edit_mode_available' }, '*')");
    expect(source).toContain("window.removeEventListener('message', onMsg)");
    expect(source).toContain("window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*')");
    expect(source).toContain("const ro = new ResizeObserver(clampToViewport)");
    expect(source).toContain("window.addEventListener('resize', clampToViewport)");
  });

  it("connects Pillar Press theme/tweak controls to persisted Store preferences and CSS variables", () => {
    const app = appShell();
    const store = storeSource();

    expect(app).toContain('const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/');
    expect(app).toContain('"typeface": "Literary"');
    expect(app).toContain('"accent": "oklch(0.520 0.118 38)"');
    expect(app).toContain('"readingSize": 17.5');
    expect(app).toContain("root.style.setProperty(\"--font-display\", f.display)");
    expect(app).toContain("root.style.setProperty(\"--font-body\", f.body)");
    expect(app).toContain('document.documentElement.style.setProperty("--accent", v)');
    expect(app).toContain('document.body.style.fontSize = (t.readingSize || 17.5) + "px"');
    expect(app).toContain('onClick={() => window.Store.toggleTheme()} title="Toggle light / dark"');
    expect(app).toContain("<TweaksLayer theme={state.theme} />");

    expect(store).toContain('if (prefs.theme === "light" || prefs.theme === "dark") state.theme = prefs.theme');
    expect(store).toContain('setTheme(t) { state.theme = t; document.documentElement.setAttribute("data-theme", t); emit(); persistPrefs(); }');
    expect(store).toContain('toggleTheme() { api.setTheme(state.theme === "dark" ? "light" : "dark"); }');
    expect(store).toContain('bg(apiSend("PUT", "/settings", { prefs }), "PUT /settings")');
  });
});
