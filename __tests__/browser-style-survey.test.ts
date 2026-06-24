import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const studioScreen = () => readFileSync(new URL("../public/screen-studio.jsx", import.meta.url), "utf8");
const studioClient = () => readFileSync(new URL("../public/studio.js", import.meta.url), "utf8");
const mediaComponents = () => readFileSync(new URL("../public/media-components.jsx", import.meta.url), "utf8");

describe("browser Studio style survey contract", () => {
  it("renders a campaign style survey with rating, knobs, notes, and round context", () => {
    const source = studioScreen();

    expect(source).toContain("function StyleSurveyModal({ campaignId, profile, mediaJobId, onClose, onSaved })");
    expect(source).toContain('const [rating, setRating] = React.useState(4)');
    expect(source).toContain("round {profile ? profile.rounds : 0} → {(profile ? profile.rounds : 0) + 1}");
    expect(source).toContain('<StField label="Rating">');
    expect(source).toContain('<StField label="Palette">');
    expect(source).toContain('<StField label="Mood">');
    expect(source).toContain('<StField label="Finish">');
    expect(source).toContain('<StField label="Detail">');
    expect(source).toContain(`<StField label="What's working">`);
    expect(source).toContain(`<StField label="What's off / want more of">`);
    expect(source).toContain("Current directive");
    expect(source).toContain("Save & update style");
  });

  it("posts the survey payload and updates Studio style state on save", () => {
    const source = studioScreen();

    expect(source).toContain("window.STUDIO.sendStyleFeedback(campaignId, { rating, knobs, working, notes, mediaJobId: mediaJobId || undefined })");
    expect(source).toContain("onSaved(p)");
    expect(source).toContain("setSaving(true); setErr(null);");
    expect(source).toContain("setErr((e && e.message) || \"Couldn't save.\"); setSaving(false);");
    expect(source).toContain("window.STUDIO.getStyle(campaignId).then((s) => { if (alive && s) setStyle(s); }).catch(() => {});");
    expect(source).toContain("{styleOpen && <StyleSurveyModal campaignId={campaignId} profile={style} mediaJobId={styleSeedJob}");
    expect(source).toContain("onClose={() => setStyleOpen(false)} onSaved={(p) => { setStyle(p); setStyleOpen(false); }}");
  });

  it("opens style tuning from completed image media and routes through the style API client", () => {
    const media = mediaComponents();
    const studio = studioScreen();
    const client = studioClient();

    expect(media).toContain(`title="Teach this campaign's image style from this result"`);
    expect(media).toContain("onTuneStyle(media)");
    expect(media).toContain("Tune style");
    expect(studio).toContain("onTuneStyle={(m) => { setStyleSeedJob(m.id); setStyleOpen(true); }}");
    expect(client).toContain('function getStyle(campaignId) { return apiGet("/campaigns/" + encodeURIComponent(campaignId) + "/style"); }');
    expect(client).toContain('function sendStyleFeedback(campaignId, body) { return apiPost("/campaigns/" + encodeURIComponent(campaignId) + "/style/feedback", body); }');
    expect(client).toContain("STYLE_KNOBS, getStyle, sendStyleFeedback");
  });
});
