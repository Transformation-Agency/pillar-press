import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const mediaComponents = () => readFileSync(new URL("../public/media-components.jsx", import.meta.url), "utf8");
const studioScreen = () => readFileSync(new URL("../public/screen-studio.jsx", import.meta.url), "utf8");

describe("browser Media library contract", () => {
  it("exposes the expected media filters and completed-card actions", () => {
    const source = mediaComponents();

    expect(source).toContain('const TABS = [["all", "All"], ["image", "Images"], ["video", "Video"], ["audio", "Audio"]]');
    expect(source).toContain('const shown = filter === "all" ? items : items.filter((m) => mediaBucket(m) === filter)');
    expect(source).toContain('media.status === "completed"');
    expect(source).toContain('title="Animate into video"');
    expect(source).toContain("Animate</button>");
    expect(source).toContain('title="Combine with an audio clip into a video"');
    expect(source).toContain("Combine</button>");
    expect(source).toContain("Tune style");
    expect(source).toContain("> Attach</button>");
    expect(source).toContain('title="Regenerate"');
    expect(source).toContain('title="Duplicate prompt"');
    expect(source).toContain('title="Download"');
    expect(source).toContain('title="Save to Google Drive"');
    expect(source).toContain('title="Delete"');
  });

  it("wires attach, detach, Drive, and combine actions to browser handlers", () => {
    const source = mediaComponents();

    expect(source).toContain("onAttach(media.id, p.id); setAttachOpen(false);");
    expect(source).toContain("onAttach(media.id, null); setAttachOpen(false);");
    expect(source).toContain("window.DRIVE.uploadMediaFile(media.id)");
    expect(source).toContain("window.KP_BILLING.notifyDriveDisabled");
    expect(source).toContain("onCombine(media, a.id); setCombineOpen(false);");
    expect(source).toContain("No voiceovers yet. Generate one in the Voice tab first.");
    expect(source).toContain("No pieces in this campaign.");
  });

  it("connects Studio media library handlers to local Store persistence and job runners", () => {
    const source = studioScreen();

    expect(source).toContain("<MediaLibrary items={allMedia} pieces={pieces}");
    expect(source).toContain('audios={allMedia.filter((m) => m.kind === "audio" && m.status === "completed")}');
    expect(source).toContain("onAttach={(id, pid) => window.Store.attachMediaToPiece(id, pid)}");
    expect(source).toContain("onDelete={(m) => window.Store.removeMedia(m.id)}");
    expect(source).toContain("onRegen={regen}");
    expect(source).toContain("onDuplicate={duplicate}");
    expect(source).toContain("onAnimate={animate}");
    expect(source).toContain("onCombine={combine}");
    expect(source).toContain("window.Store.addMedia({ ...m, id: undefined, jobId: null, status: \"queued\"");
    expect(source).toContain("window.STUDIO.runJob(copy, (patch) => window.Store.updateMedia(copy.id, patch))");
    expect(source).toContain('const animate = (m) => { setType("video"); setStartImage(m.outputUrl); setPrompt(m.prompt || ""); };');
    expect(source).toContain('kind: "avatar", status: "queued", progress: 0');
    expect(source).toContain('prompt: "Combined image + audio → video"');
  });
});
