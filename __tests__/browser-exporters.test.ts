import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function loadBrowserExporters(document?: unknown) {
  const source = readFileSync(new URL("../public/exporters.js", import.meta.url), "utf8");
  const window = {} as Record<string, unknown>;
  const urls: string[] = [];
  const revoked: string[] = [];
  runInNewContext(source, {
    window,
    Blob,
    TextEncoder,
    setTimeout,
    document,
    URL: {
      createObjectURL: (blob: Blob) => {
        urls.push(blob.type || "");
        return `blob:${urls.length}`;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    },
  });
  return { exp: window.EXPORT as any, urls, revoked };
}

describe("browser exporters", () => {
  it("downloads text through a temporary anchor and cleans up the object URL", async () => {
    vi.useFakeTimers();
    const clicked: string[] = [];
    const removed: unknown[] = [];
    const anchors: Array<{ href?: string; download?: string; click: () => void }> = [];
    const document = {
      createElement: () => {
        const anchor = { click: () => clicked.push(anchor.download || "") } as {
          href?: string;
          download?: string;
          click: () => void;
        };
        anchors.push(anchor);
        return anchor;
      },
      body: {
        appendChild: vi.fn(),
        removeChild: (node: unknown) => removed.push(node),
      },
    };
    const { exp, urls, revoked } = loadBrowserExporters(document);

    exp.downloadText("# Hello", "hello.md");

    expect(clicked).toEqual(["hello.md"]);
    expect(document.body.appendChild).toHaveBeenCalledWith(anchors[0]);
    expect(anchors[0].href).toBe("blob:1");
    expect(anchors[0].download).toBe("hello.md");
    expect(urls).toEqual(["text/markdown;charset=utf-8"]);
    await vi.runAllTimersAsync();
    expect(removed).toEqual([anchors[0]]);
    expect(revoked).toEqual(["blob:1"]);
    vi.useRealTimers();
  });

  it("creates a download-all zip containing one markdown file per output", async () => {
    const { exp } = loadBrowserExporters();
    const zip = exp.zipBlob([
      { name: "Substack.md", content: "# Substack\n\nPost body" },
      { name: "Facebook.md", content: "# Facebook\n\nPost body" },
    ]);

    expect(zip.type).toBe("application/zip");
    const bytes = new Uint8Array(await zip.arrayBuffer());
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("Substack.md");
    expect(text).toContain("# Substack\n\nPost body");
    expect(text).toContain("Facebook.md");
    expect(text).toContain("# Facebook\n\nPost body");
  });

  it("builds combined markdown using outputOrder and safe filenames for outputs", () => {
    const { exp } = loadBrowserExporters();
    const piece = {
      title: "My Piece",
      outputs: {
        x: { platform: "X", selectedAudience: "Builders", throughlineTag: "short", strategicPurpose: "Start conversation.", draftPost: "Post", hooks: [], ctas: [], mediaRec: "Image", riskCheck: "Clear", relatedOffering: "Offer", followUp: "Next" },
        substack: { platform: "Substack", selectedAudience: "Readers", throughlineTag: "long", strategicPurpose: "Go deeper.", draftPost: "Essay", hooks: [], ctas: [], mediaRec: "Hero", riskCheck: "Clear", relatedOffering: "Newsletter", followUp: "Reply" },
      },
      outputOrder: ["substack", "missing", "x"],
    };

    const md = exp.pieceOutputsMarkdown(piece);

    expect(md.indexOf("# Substack")).toBeLessThan(md.indexOf("# X"));
    expect(md).not.toContain("missing");
    expect(exp.safeName("Pillar Press / Output")).toBe("Pillar-Press-Output");
  });
});
