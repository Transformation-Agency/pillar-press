import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "pillar-press-media-library-"));
  process.env.PILLAR_PRESS_DATA_DIR = dir;
  process.env.PILLAR_PRESS_LOCAL_FIRST = "true";
  delete process.env.DEFAULT_USER_ID;
});

afterEach(async () => {
  const { resetLocalDbForTests } = await import("@/lib/local/database");
  resetLocalDbForTests();
  delete process.env.PILLAR_PRESS_DATA_DIR;
  delete process.env.PILLAR_PRESS_LOCAL_FIRST;
  delete process.env.DEFAULT_USER_ID;
  rmSync(dir, { recursive: true, force: true });
});

describe("media library routes", () => {
  it("lists media, filters by attached piece, attaches, detaches, and deletes local media jobs", async () => {
    const {
      createLocalCampaign,
      createLocalMediaJob,
      createLocalPiece,
      getLocalMediaJob,
      listLocalMediaJobs,
    } = await import("@/lib/local/database");
    const campaign = createLocalCampaign({ name: "Studio library" });
    const piece = createLocalPiece({
      campaignId: campaign.id,
      userId: "local-owner",
      title: "Media-backed article",
    });
    expect(piece).toBeTruthy();

    const imageJob = createLocalMediaJob({
      userId: "local-owner",
      workspaceId: "local-workspace",
      campaignId: campaign.id,
      type: "image",
      prompt: "A calm editorial cover image",
      modelId: "gpt-image-1",
      modelName: "GPT Image",
      status: "completed",
      progress: 100,
      outputUrl: "https://cdn.test/cover.png",
      downloadUrl: "https://cdn.test/cover-download.png",
      thumbnailUrl: "https://cdn.test/cover-thumb.png",
      meta: { source: "studio" },
    });
    const audioJob = createLocalMediaJob({
      userId: "local-owner",
      workspaceId: "local-workspace",
      campaignId: campaign.id,
      type: "audio",
      prompt: "Read the intro aloud",
      modelId: "elevenlabs",
      modelName: "ElevenLabs",
      status: "completed",
      progress: 100,
      outputUrl: "https://cdn.test/voice.mp3",
    });

    const mediaRoute = await import("../app/api/media/route");
    const mediaItemRoute = await import("../app/api/media/[id]/route");

    const listResponse = await mediaRoute.GET(new Request("http://test.local/api/media"));
    const listBody = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listBody.items.map((item: { id: string }) => item.id).sort()).toEqual([audioJob.id, imageJob.id].sort());
    expect(listBody.items.find((item: { id: string }) => item.id === imageJob.id)).toMatchObject({
      type: "image",
      status: "completed",
      outputUrl: "https://cdn.test/cover.png",
      downloadUrl: "https://cdn.test/cover-download.png",
      thumbnailUrl: "https://cdn.test/cover-thumb.png",
      meta: { source: "studio" },
    });

    const attachResponse = await mediaItemRoute.PATCH(new Request("http://test.local/api/media/" + imageJob.id, {
      method: "PATCH",
      body: JSON.stringify({ pieceId: piece!.id }),
    }), { params: Promise.resolve({ id: imageJob.id }) });
    const attached = await attachResponse.json();
    expect(attachResponse.status).toBe(200);
    expect(attached.job).toMatchObject({ id: imageJob.id, pieceId: piece!.id, sourceContentId: piece!.id });

    const filteredResponse = await mediaRoute.GET(new Request("http://test.local/api/media?pieceId=" + piece!.id));
    const filtered = await filteredResponse.json();
    expect(filtered.items.map((item: { id: string }) => item.id)).toEqual([imageJob.id]);

    const detachResponse = await mediaItemRoute.PATCH(new Request("http://test.local/api/media/" + imageJob.id, {
      method: "PATCH",
      body: JSON.stringify({ pieceId: null }),
    }), { params: Promise.resolve({ id: imageJob.id }) });
    const detached = await detachResponse.json();
    expect(detachResponse.status).toBe(200);
    expect(detached.job).toMatchObject({ id: imageJob.id, pieceId: null, sourceContentId: null });

    const deleteResponse = await mediaRoute.DELETE(new Request("http://test.local/api/media?id=" + encodeURIComponent(audioJob.id), {
      method: "DELETE",
    }));
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ ok: true });
    expect(getLocalMediaJob(audioJob.id, "local-owner")).toBeNull();
    expect(listLocalMediaJobs("local-owner").map((item) => item.id)).toEqual([imageJob.id]);
  });

  it("does not reveal or mutate another user's media jobs or attach to unknown pieces", async () => {
    const {
      createLocalCampaign,
      createLocalMediaJob,
      getLocalMediaJob,
    } = await import("@/lib/local/database");
    const campaign = createLocalCampaign({ name: "Scoped media" });
    const otherJob = createLocalMediaJob({
      userId: "other-owner",
      workspaceId: "local-workspace",
      campaignId: campaign.id,
      type: "image",
      modelId: "gpt-image-1",
      status: "completed",
      outputUrl: "https://cdn.test/other.png",
    });

    const mediaRoute = await import("../app/api/media/route");
    const mediaItemRoute = await import("../app/api/media/[id]/route");

    const listResponse = await mediaRoute.GET(new Request("http://test.local/api/media"));
    const listBody = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listBody.items).toEqual([]);

    const crossUserPatch = await mediaItemRoute.PATCH(new Request("http://test.local/api/media/" + otherJob.id, {
      method: "PATCH",
      body: JSON.stringify({ pieceId: null }),
    }), { params: Promise.resolve({ id: otherJob.id }) });
    expect(crossUserPatch.status).toBe(404);
    expect(await crossUserPatch.json()).toMatchObject({ code: "not_found" });
    expect(getLocalMediaJob(otherJob.id, "other-owner")).toBeTruthy();

    const ownJob = createLocalMediaJob({
      userId: "local-owner",
      workspaceId: "local-workspace",
      campaignId: campaign.id,
      type: "image",
      modelId: "gpt-image-1",
      status: "completed",
    });
    const missingPiecePatch = await mediaItemRoute.PATCH(new Request("http://test.local/api/media/" + ownJob.id, {
      method: "PATCH",
      body: JSON.stringify({ pieceId: randomUUID() }),
    }), { params: Promise.resolve({ id: ownJob.id }) });
    expect(missingPiecePatch.status).toBe(404);
    expect(await missingPiecePatch.json()).toMatchObject({ code: "not_found" });

    const crossUserDelete = await mediaRoute.DELETE(new Request("http://test.local/api/media?id=" + encodeURIComponent(otherJob.id), {
      method: "DELETE",
    }));
    expect(crossUserDelete.status).toBe(200);
    expect(getLocalMediaJob(otherJob.id, "other-owner")).toBeTruthy();
  });
});
