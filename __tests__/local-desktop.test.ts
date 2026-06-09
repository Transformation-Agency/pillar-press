import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BookChapter } from "@/lib/exporters";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kings-press-local-"));
  process.env.KINGS_PRESS_DATA_DIR = dir;
  process.env.KINGS_PRESS_STORAGE = "local";
});

afterEach(async () => {
  const { resetLocalDbForTests } = await import("@/lib/local/database");
  resetLocalDbForTests();
  delete process.env.KINGS_PRESS_DATA_DIR;
  delete process.env.KINGS_PRESS_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("local desktop database", () => {
  it("creates the default workspace without preloading campaigns", async () => {
    const { createLocalCampaign, ensureLocalWorkspace, getLocalReferences, listLocalCampaigns } = await import("@/lib/local/database");

    expect(ensureLocalWorkspace()).toBe("local-workspace");
    expect(listLocalCampaigns()).toHaveLength(0);

    const campaign = createLocalCampaign({ name: "First Campaign" });
    expect(listLocalCampaigns()).toHaveLength(1);
    expect(campaign).toMatchObject({ name: "First Campaign", slug: "first-campaign" });
    expect(getLocalReferences(campaign.id)?.doc).toMatchObject({
      strategy: { throughlines: [], body: "" },
      audiences: { list: [] },
    });
  });

  it("persists Gather schedules in the local database", async () => {
    const { listEnabledLocalGatherSchedules, listLocalGatherSchedules, markLocalGatherScheduleRun, saveLocalGatherSchedule, deleteLocalGatherSchedule } = await import("@/lib/local/database");
    const { isGatherScheduleDue } = await import("@/lib/gather/scheduleDue");

    const saved = saveLocalGatherSchedule({
      campaignId: "campaign-from-current-runtime",
      cadence: "weekly",
      timeOfDay: "09:30",
      dayOfWeek: 2,
    });

    expect(saved).toMatchObject({
      campaignId: "campaign-from-current-runtime",
      cadence: "weekly",
      timeOfDay: "09:30",
      dayOfWeek: 2,
      enabled: true,
    });
    expect(listLocalGatherSchedules("campaign-from-current-runtime")).toHaveLength(1);
    expect(listEnabledLocalGatherSchedules()).toHaveLength(1);
    expect(isGatherScheduleDue(saved, new Date("2026-06-09T16:00:00"))).toBe(true);
    markLocalGatherScheduleRun(saved.id, "ok", "local-owner");
    expect(listLocalGatherSchedules("campaign-from-current-runtime")[0]).toMatchObject({ lastStatus: "ok" });
    expect(deleteLocalGatherSchedule(saved.id)).toBe(true);
    expect(listLocalGatherSchedules("campaign-from-current-runtime")).toHaveLength(0);
  });

  it("persists Gather sources and items in the local database", async () => {
    const {
      createLocalCampaign,
      createLocalGatherItem,
      createLocalGatherSource,
      deleteLocalGatherItem,
      deleteLocalGatherSource,
      existingLocalGatherItemUrls,
      listLocalGatherItems,
      listLocalGatherSources,
      updateLocalGatherSource,
    } = await import("@/lib/local/database");

    const campaign = createLocalCampaign({ name: "Research Desk" });
    const source = createLocalGatherSource({
      campaignId: campaign.id,
      kind: "rss",
      config: "https://example.com/feed.xml",
      label: "Example feed",
    });

    expect(source).toMatchObject({
      campaignId: campaign.id,
      kind: "rss",
      config: "https://example.com/feed.xml",
      enabled: true,
    });

    const updatedSource = updateLocalGatherSource(source!.id, "local-owner", {
      lastRun: "2026-06-08T00:00:00.000Z",
      lastCount: 1,
      summary: "One useful thing surfaced.",
      summaryAt: "2026-06-08T00:00:01.000Z",
      summaryItemCount: 1,
    });
    expect(updatedSource).toMatchObject({ lastCount: 1, summaryItemCount: 1 });
    expect(listLocalGatherSources(campaign.id)).toHaveLength(1);

    const item = createLocalGatherItem({
      campaignId: campaign.id,
      sourceId: source!.id,
      kind: "rss",
      title: "Useful result",
      source: "Example",
      url: "https://example.com/result",
      publishedAt: "2026-06-08",
      snippet: "A short summary.",
      raw: { ok: true },
    });

    expect(item).toMatchObject({
      title: "Useful result",
      date: "2026-06-08",
      selected: false,
    });
    expect(item?.raw).toEqual({ ok: true });
    expect(existingLocalGatherItemUrls(campaign.id)).toEqual(new Set(["https://example.com/result"]));
    expect(listLocalGatherItems(campaign.id)).toHaveLength(1);

    expect(deleteLocalGatherItem(item!.id)).toBe(true);
    expect(listLocalGatherItems(campaign.id)).toHaveLength(0);
    expect(deleteLocalGatherSource(source!.id)).toBe(true);
    expect(listLocalGatherSources(campaign.id)).toHaveLength(0);
  });

  it("persists settings and media jobs in the local database", async () => {
    const {
      createLocalCampaign,
      createLocalMediaJob,
      createLocalPiece,
      deleteLocalMediaJob,
      getLocalMediaJob,
      getOrCreateLocalSettings,
      listLocalMediaJobs,
      updateLocalMediaJob,
      updateLocalSettings,
    } = await import("@/lib/local/database");

    const initialSettings = getOrCreateLocalSettings("local-owner", "local-workspace");
    expect(initialSettings.prefs).toEqual({});

    const updatedSettings = updateLocalSettings("local-owner", "local-workspace", {
      driveFolderId: "local-folder",
      prefs: { theme: "dark", activeCampaignId: "camp" },
    });
    expect(updatedSettings.driveFolderId).toBe("local-folder");
    expect(updatedSettings.prefs).toMatchObject({ theme: "dark", activeCampaignId: "camp" });

    const campaign = createLocalCampaign({ name: "Media Desk" });
    const piece = createLocalPiece({
      campaignId: campaign.id,
      userId: "local-owner",
      title: "Media piece",
    });

    const job = createLocalMediaJob({
      userId: "local-owner",
      workspaceId: "local-workspace",
      campaignId: campaign.id,
      type: "image",
      modelId: "local-image",
      modelName: "Local Image",
      status: "completed",
      progress: 100,
      outputUrl: "/api/local-files/image/example.png",
      meta: { prompt: "cover" },
    });
    expect(job).toMatchObject({
      type: "image",
      status: "completed",
      outputUrl: "/api/local-files/image/example.png",
    });
    expect(job.meta).toEqual({ prompt: "cover" });
    expect(listLocalMediaJobs("local-owner")).toHaveLength(1);

    const attached = updateLocalMediaJob(job.id, "local-owner", { pieceId: piece!.id });
    expect(attached?.pieceId).toBe(piece!.id);
    expect(listLocalMediaJobs("local-owner", piece!.id)).toHaveLength(1);
    expect(getLocalMediaJob(job.id, "local-owner")?.sourceContentId).toBe(piece!.id);

    expect(deleteLocalMediaJob(job.id, "local-owner")).toBe(true);
    expect(listLocalMediaJobs("local-owner")).toHaveLength(0);
  });

  it("supports the core local editorial workflow", async () => {
    const {
      createLocalCampaign,
      createLocalPiece,
      deleteLocalPiece,
      getLocalReferences,
      listLocalPieces,
      renameLocalCampaign,
      updateLocalPiece,
      updateLocalReferences,
    } = await import("@/lib/local/database");

    const campaign = createLocalCampaign({ name: "Local Book" });
    expect(campaign).toMatchObject({ name: "Local Book", slug: "local-book" });

    const renamed = renameLocalCampaign(campaign.id, "Local Manuscript");
    expect(renamed).toMatchObject({ id: campaign.id, name: "Local Manuscript" });

    const refs = getLocalReferences(campaign.id);
    expect(refs?.doc).toHaveProperty("strategy");

    const updatedRefs = updateLocalReferences(campaign.id, { patch: { custom: { title: "Custom" } } });
    expect(updatedRefs?.doc).toHaveProperty("custom");

    const piece = createLocalPiece({
      campaignId: campaign.id,
      userId: "local-owner",
      title: "Chapter one",
      original: "Draft body",
    });
    expect(piece).toMatchObject({ title: "Chapter one", status: "Draft", original: "Draft body" });
    expect(listLocalPieces(campaign.id)).toHaveLength(1);

    const edited = updateLocalPiece(piece!.id, "local-owner", {
      title: "Chapter 1",
      status: "Reviewed",
      gateNotes: { clarity: "Tighten the second paragraph." },
      packet: { clarity: { ok: true } },
      revision: { text: "Revised body", changelog: [] },
      outputs: { substack: { draftPost: "Post body" } },
      outputOrder: ["substack"],
    });
    expect(edited).toMatchObject({ title: "Chapter 1", status: "Reviewed" });
    expect(edited?.gateNotes).toEqual({ clarity: "Tighten the second paragraph." });
    expect(edited?.packet).toEqual({ clarity: { ok: true } });
    expect(edited?.revision).toEqual({ text: "Revised body", changelog: [] });
    expect(edited?.outputs).toEqual({ substack: { draftPost: "Post body" } });
    expect(edited?.outputOrder).toEqual(["substack"]);

    expect(deleteLocalPiece(piece!.id, "local-owner")).toBe(true);
    expect(listLocalPieces(campaign.id)).toHaveLength(0);
  });

  it("persists learned style profiles and feedback locally", async () => {
    const {
      createLocalCampaign,
      createLocalStyleFeedback,
      getLocalStyleProfile,
      listLocalStyleFeedback,
      upsertLocalStyleProfile,
    } = await import("@/lib/local/database");

    const campaign = createLocalCampaign({ name: "Visual Desk" });

    expect(getLocalStyleProfile(campaign.id)).toBeNull();
    const profile = upsertLocalStyleProfile({
      campaignId: campaign.id,
      userId: "local-owner",
      knobs: { palette: "muted", mood: "moody", finish: "painterly", detail: "detailed" },
      directive: "Use a muted, moody painterly look with deliberate texture.",
      rounds: 1,
    });

    expect(profile).toMatchObject({
      campaignId: campaign.id,
      userId: "local-owner",
      rounds: 1,
      directive: "Use a muted, moody painterly look with deliberate texture.",
    });
    expect(profile?.knobs).toEqual({ palette: "muted", mood: "moody", finish: "painterly", detail: "detailed" });

    const updated = upsertLocalStyleProfile({
      campaignId: campaign.id,
      userId: "local-owner",
      knobs: { palette: "cool", mood: "neutral", finish: "photographic", detail: "balanced" },
      directive: "Cool, neutral editorial photography with clean negative space.",
      rounds: 2,
    });
    expect(updated).toMatchObject({ id: profile!.id, rounds: 2 });
    expect(updated?.knobs.palette).toBe("cool");

    const feedback = createLocalStyleFeedback({
      campaignId: campaign.id,
      rating: 4,
      knobs: updated!.knobs,
      working: "The negative space works.",
      notes: "Make the light softer.",
    });
    expect(feedback).toMatchObject({ campaignId: campaign.id, rating: 4 });
    expect(listLocalStyleFeedback(campaign.id)).toHaveLength(1);
  });

  it("provides local chapters for book export ordering", async () => {
    const { bookMarkdown, sortChaptersForBook } = await import("@/lib/exporters");
    const {
      createLocalCampaign,
      createLocalPiece,
      listLocalPieces,
      updateLocalPiece,
    } = await import("@/lib/local/database");

    const campaign = createLocalCampaign({ name: "Local Manuscript Export" });
    const second = createLocalPiece({
      campaignId: campaign.id,
      userId: "local-owner",
      title: "Chapter 2: The Door",
      original: "Second chapter.",
    });
    const first = createLocalPiece({
      campaignId: campaign.id,
      userId: "local-owner",
      title: "Chapter 1: The Key",
      original: "",
    });
    updateLocalPiece(first!.id, "local-owner", { revision: { text: "First chapter fallback.", changelog: [] } });

    const chapters = sortChaptersForBook(
      listLocalPieces(campaign.id)!.map((piece): BookChapter => ({
        title: piece.title,
        original: piece.original,
        revision: piece.revision as { text?: string | null } | null,
        createdAt: piece.createdAt,
      })),
    );
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1: The Key", "Chapter 2: The Door"]);
    expect(bookMarkdown({ title: campaign.name, chapters })).toContain("First chapter fallback.");
    expect(second).toMatchObject({ title: "Chapter 2: The Door" });
  });
});

describe("local desktop storage", () => {
  it("writes generated media under the app data storage folder", async () => {
    const { writeLocalPublicFile, isLocalStoredUrl } = await import("@/lib/local/storage");

    const url = writeLocalPublicFile(Buffer.from("hello"), "voice.mp3", "audio/mpeg", "voice");

    expect(url).toMatch(/^\/api\/local-files\/voice\//);
    expect(isLocalStoredUrl(url)).toBe(true);
  });
});
