import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const clientSource = () => readFileSync(new URL("../public/feedback-client.js", import.meta.url), "utf8");
const widgetSource = () => readFileSync(new URL("../public/feedback-widget.jsx", import.meta.url), "utf8");
const appSource = () => readFileSync(new URL("../public/app.jsx", import.meta.url), "utf8");
const buildSource = () => readFileSync(new URL("../scripts/build-static-browser-shell.ts", import.meta.url), "utf8");

describe("Pillar Press feedback widget", () => {
  it("posts Pillar Press feedback to the shared feedback endpoint", () => {
    const client = clientSource();
    const widget = widgetSource();

    expect(client).toContain("https://project-cw1bz.vercel.app");
    expect(client).toContain("window.PILLAR_PRESS_FEEDBACK_API_BASE");
    expect(client).toContain("window.PILLAR_FEEDBACK_API_BASE");
    expect(client).toContain("window.PRISM_FEEDBACK_API_BASE");
    expect(client).toContain('pillarPressFeedbackApiBase() + "/api/feedback"');
    expect(widget).toContain('product: "pillar-press"');
    expect(widget).toContain("window.submitPillarPressFeedback");
  });

  it("validates screenshots and preserves failed submissions in the modal", () => {
    const widget = widgetSource();

    expect(widget).toContain("PILLAR_PRESS_FEEDBACK_MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024");
    expect(widget).toContain('!/^image\\//i.test(file.type || "")');
    expect(widget).toContain('setMessage({ type: "error", text: (e && e.message) || "Feedback could not be submitted." })');
    expect(widget).toContain("window.addEventListener(\"paste\", onPaste)");
    expect(widget).toContain("setOpen(false)");
  });

  it("is mounted once at the app shell with a topbar trigger", () => {
    const app = appSource();

    expect(app).toContain("const [feedbackOpenSignal, setFeedbackOpenSignal] = React.useState(0)");
    expect(app).toContain("const openFeedback = () => setFeedbackOpenSignal");
    expect(app).toContain("<FeedbackWidget");
    expect(app).toContain("openSignal={feedbackOpenSignal}");
    expect(app).toContain("route={view || \"desk\"}");
  });

  it("is included in the custom static browser shell build with env injection", () => {
    const build = buildSource();

    expect(build).toContain('"feedback-client.js"');
    expect(build).toContain('"feedback-widget.jsx"');
    expect(build).toContain("process.env.VITE_PILLAR_PRESS_FEEDBACK_API_BASE");
    expect(build).toContain("window.PILLAR_PRESS_FEEDBACK_API_BASE");
  });
});
