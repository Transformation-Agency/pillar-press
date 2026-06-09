import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, mediaJobs, references, pieces } from "@/lib/db";
import { styleProfiles } from "@/db/style-schema";
import {
  createLocalMediaJob,
  getLocalMediaJob,
  getLocalPiece,
  getLocalReferences,
  getLocalStyleProfile,
} from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import {
  listModels, generateAsset, createAsset, uploadAsset, type GenerateInput, type GenerationType,
} from "@/lib/hedra";
import { textToSpeechLong } from "@/lib/elevenlabs";
import { uploadPublicAudio } from "@/lib/storage";
import { buildRefContext, type ReferencesDoc } from "@/lib/refContext";
import { craftImagePrompt } from "@/lib/ai/imagePrompt";
import { getAIForTask } from "@/lib/llm";
import { generateBodySchema, validateAgainstModel, sanitizeText } from "@/lib/validation";
import { toErrorResponse } from "@/lib/errors";
import { getAudioProviderConfig, getImageProviderConfig } from "@/lib/mediaProviders";
import { generateOpenAICompatibleImage } from "@/lib/mediaImage";
import { generateOpenAICompatibleSpeech } from "@/lib/mediaAudio";

/** Trim a piece down to a prompt-sized excerpt for image grounding. */
function pieceExcerpt(p: { original?: string | null; revision?: unknown } | undefined): string {
  if (!p) return "";
  const rev = p.revision as { text?: string } | null | undefined;
  const text = (rev?.text || p.original || "").replace(/\s+/g, " ").trim();
  return text.slice(0, 700);
}

const pct = (p: number | undefined) => (p == null ? 0 : Math.round(p <= 1 ? p * 100 : p));

/**
 * A start image can arrive as a raw Hedra asset id, an http(s) URL (a library
 * image), or a data: URL (an uploaded file). Hedra's start_keyframe_id needs an
 * asset id, so anything URL-shaped is fetched and uploaded first.
 */
async function resolveStartAsset(ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined;
  const isUrl = ref.startsWith("http://") || ref.startsWith("https://") || ref.startsWith("data:");
  if (!isUrl) return ref; // already an asset id
  const resp = await fetch(ref);
  if (!resp.ok) throw new Error("Could not load the start image.");
  const blob = await resp.blob();
  const ext = (blob.type && blob.type.split("/")[1]) || "png";
  const name = `start-frame-${Date.now()}.${ext}`;
  const asset = await createAsset({ name, type: "image" });
  await uploadAsset(asset.id, blob, name);
  return asset.id;
}

// POST /api/hedra/generate
// - audio: ElevenLabs TTS rendered to an inline data URL (no Hedra), persisted
//   as a completed job.
// - image: flat Hedra text-to-image (poll status; the asset carries the URL).
// - video / avatar_video: Hedra video; avatar/video with a script first renders
//   TTS on ElevenLabs and uploads it to Hedra as the audio track.
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = generateBodySchema.parse(await req.json());

    // ── Audio (ElevenLabs TTS) — no Hedra model involved ───────────────────
    if (body.type === "audio") {
      const script = sanitizeText(body.script || body.prompt, 100000);
      if (!script) return NextResponse.json({ error: "Provide a script to voice.", code: "validation" }, { status: 422 });

      const audioProvider = getAudioProviderConfig(body.provider);
      let audioUrl: string;
      let audioVoice = body.voiceId;
      const meta: Record<string, unknown> = {};
      if (audioProvider) {
        const result = await generateOpenAICompatibleSpeech({
          config: audioProvider,
          model: body.modelId,
          text: script,
          voice: body.voiceId,
        });
        audioUrl = result.outputUrl;
        audioVoice = result.voice;
        meta.provider = audioProvider.provider;
      } else {
        if (!body.voiceId) return NextResponse.json({ error: "Pick a voice.", code: "validation" }, { status: 422 });
        // Long scripts are chunked + stitched, then stored (an inline data URL
        // would exceed the serverless response limit). Fall back to inline only
        // for small clips when storage isn't configured (e.g. local dev).
        const buf = await textToSpeechLong({ text: script, voiceId: body.voiceId });
        try {
          audioUrl = await uploadPublicAudio(buf, `voiceover-${Date.now()}.mp3`);
        } catch (e) {
          if (buf.length <= 4_000_000) audioUrl = `data:audio/mpeg;base64,${buf.toString("base64")}`;
          else throw e;
        }
        meta.provider = "elevenlabs";
      }

      const jobValues = {
          userId: user.id,
          workspaceId: user.workspaceId,
          campaignId: body.campaignId,
          sourceContentId: body.pieceId,
          type: "audio",
          prompt: script.slice(0, 2000),
          modelId: body.modelId,
          voiceId: audioVoice,
          status: "completed",
          progress: 100,
          outputUrl: audioUrl,
          downloadUrl: audioUrl,
          completedAt: new Date(),
          meta,
      } as const;
      if (isLocalFirstMode()) {
        const job = createLocalMediaJob({
          ...jobValues,
          userId: user.id,
          workspaceId: user.workspaceId ?? null,
          type: "audio",
          modelId: body.modelId,
          completedAt: jobValues.completedAt.toISOString(),
        });
        return NextResponse.json({ job }, { status: 201 });
      }

      const [job] = await db
        .insert(mediaJobs)
        .values(jobValues)
        .returning();
      return NextResponse.json({ job }, { status: 201 });
    }

    // ── OpenAI-compatible image providers ─────────────────────────────────
    const imageProvider = getImageProviderConfig(body.provider);
    if (body.type === "image" && imageProvider) {
      const prompt = sanitizeText(body.prompt, 2000);
      if (!prompt) return NextResponse.json({ error: "Provide an image prompt.", code: "validation" }, { status: 422 });

      const result = await generateOpenAICompatibleImage({
        config: imageProvider,
        model: body.modelId,
        prompt,
        aspectRatio: body.aspectRatio,
        resolution: body.resolution,
      });

      const jobValues = {
        userId: user.id,
        workspaceId: user.workspaceId,
        campaignId: body.campaignId,
        sourceContentId: body.pieceId,
        type: "image",
        prompt,
        modelId: body.modelId,
        modelName: `${imageProvider.provider}:${body.modelId}`,
        aspectRatio: body.aspectRatio,
        resolution: body.resolution,
        status: "completed",
        progress: 100,
        outputUrl: result.outputUrl,
        downloadUrl: result.downloadUrl,
        completedAt: new Date(),
        meta: { provider: imageProvider.provider, providerResponseId: result.providerResponseId ?? null },
      } as const;

      if (isLocalFirstMode()) {
        const job = createLocalMediaJob({
          ...jobValues,
          userId: user.id,
          workspaceId: user.workspaceId ?? null,
          campaignId: body.campaignId ?? null,
          sourceContentId: body.pieceId ?? null,
          type: "image",
          modelId: body.modelId,
          completedAt: jobValues.completedAt.toISOString(),
        });
        return NextResponse.json({ job }, { status: 201 });
      }

      const [job] = await db
        .insert(mediaJobs)
        .values(jobValues)
        .returning();
      return NextResponse.json({ job }, { status: 201 });
    }

    // ── Image / Video / Avatar (Hedra) ─────────────────────────────────────
    const wanted: GenerationType = body.type === "avatar_video" ? "video" : (body.type as GenerationType);
    const models = await listModels([wanted]);
    const model = models.find((m) => m.id === body.modelId);
    if (!model) return NextResponse.json({ error: "Unknown or unavailable model.", code: "bad_request" }, { status: 400 });

    const reqErr = validateAgainstModel(body, model);
    if (reqErr) return NextResponse.json({ error: reqErr, code: "validation" }, { status: 422 });

    let audioAssetId = body.audioAssetId;

    // Combine: use an EXISTING audio media item as the video's audio track —
    // fetch its bytes and upload them to Hedra as an audio asset.
    if (!audioAssetId && body.audioMediaId && (body.type === "avatar_video" || body.type === "video")) {
      const am = isLocalFirstMode()
        ? getLocalMediaJob(body.audioMediaId, user.id)
        : await db.query.mediaJobs.findFirst({
            where: and(eq(mediaJobs.id, body.audioMediaId), eq(mediaJobs.userId, user.id)),
          });
      const aurl = am?.downloadUrl || am?.outputUrl;
      if (!aurl) return NextResponse.json({ error: "That audio isn't ready to combine.", code: "validation" }, { status: 422 });
      let abytes: Buffer;
      if (aurl.startsWith("data:")) {
        abytes = Buffer.from(aurl.slice(aurl.indexOf(",") + 1), "base64");
      } else {
        const ar = await fetch(aurl);
        if (!ar.ok) return NextResponse.json({ error: "Couldn't fetch the audio file.", code: "upstream" }, { status: 502 });
        abytes = Buffer.from(await ar.arrayBuffer());
      }
      const aname = `combine-${Date.now()}.mp3`;
      const aasset = await createAsset({ name: aname, type: "audio" });
      await uploadAsset(aasset.id, new Blob([new Uint8Array(abytes)], { type: "audio/mpeg" }), aname);
      audioAssetId = aasset.id;
    }

    // Voiceover for avatar/synced video: render TTS and upload it to Hedra.
    if (!audioAssetId && body.script && (body.type === "avatar_video" || body.type === "video")) {
      const buf = await textToSpeechLong({ text: sanitizeText(body.script, 100000), voiceId: body.voiceId ?? "" });
      const asset = await createAsset({ name: `voiceover-${Date.now()}.mp3`, type: "audio" });
      await uploadAsset(asset.id, new Blob([new Uint8Array(buf)], { type: "audio/mpeg" }), `voiceover-${Date.now()}.mp3`);
      audioAssetId = asset.id;
    }

    const input: GenerateInput = {
      type: model.type === "image" ? "image" : "video",
      modelId: model.id,
      textPrompt: sanitizeText(body.prompt, 2000) || sanitizeText(body.script, 2000) || undefined,
      aspectRatio: body.aspectRatio,
      resolution: body.resolution,
      startAssetId: await resolveStartAsset(body.startAssetId),
      audioAssetId,
      durationMs: body.duration ? body.duration * 1000 : undefined,
    };
    // Load the campaign's learned style (record provenance regardless of path).
    const prof = body.campaignId
      ? isLocalFirstMode()
        ? getLocalStyleProfile(body.campaignId, user.workspaceId)
        : await db.query.styleProfiles.findFirst({ where: eq(styleProfiles.campaignId, body.campaignId) })
      : null;
    const meta: Record<string, unknown> = {};
    if (prof) { meta.styleRound = prof.rounds; meta.styleKnobs = prof.knobs; }

    if (body.type === "image" && body.enhance !== false) {
      // Art-direct the prompt: weave the seed + the article + brand + learned
      // style into a vivid, specifically-composed cover-image prompt.
      let refCtx = "";
      if (body.campaignId) {
        const ref = isLocalFirstMode()
          ? getLocalReferences(body.campaignId, user.workspaceId)
          : await db.query.references.findFirst({ where: eq(references.campaignId, body.campaignId) });
        refCtx = buildRefContext((ref?.doc as ReferencesDoc | undefined) ?? null);
      }
      let article: { title?: string; excerpt?: string } | undefined;
      if (body.pieceId) {
        const pc = isLocalFirstMode()
          ? getLocalPiece(body.pieceId, user.id, user.workspaceId)
          : await db.query.pieces.findFirst({ where: eq(pieces.id, body.pieceId) });
        if (pc) article = { title: pc.title, excerpt: pieceExcerpt(pc) };
      }
      const enhanced = await craftImagePrompt({
        seed: sanitizeText(body.prompt, 2000),
        styleDirective: prof?.directive || "",
        refContext: refCtx,
        article,
      }, getAIForTask("mediaPrompt"));
      input.textPrompt = enhanced || input.textPrompt;
      meta.enhancedPrompt = enhanced;
    } else if (prof?.directive && !body.directed) {
      // Non-enhanced path (video/avatar, or image with enhance off): keep the
      // learned directive prepended so the look still carries. Skipped when the
      // prompt is already an art-directed one sent verbatim (it has the style).
      input.textPrompt = input.textPrompt ? `${prof.directive}\n\n${input.textPrompt}` : prof.directive;
    }

    const styleMeta = Object.keys(meta).length ? meta : undefined;
    const gen = await generateAsset(input);

    if (isLocalFirstMode()) {
      const job = createLocalMediaJob({
        userId: user.id,
        workspaceId: user.workspaceId ?? null,
        campaignId: body.campaignId ?? null,
        sourceContentId: body.pieceId ?? null,
        meta: styleMeta,
        hedraGenerationId: gen.id,
        hedraAssetId: gen.asset_id ?? null,
        elevenAudioAssetId: audioAssetId ?? null,
        type: body.type,
        prompt: sanitizeText(body.prompt, 2000),
        modelId: model.id,
        modelName: model.name,
        voiceId: body.voiceId ?? null,
        aspectRatio: body.aspectRatio ?? null,
        resolution: body.resolution ?? null,
        duration: body.duration ?? null,
        status: (gen.status as any) ?? "queued",
        progress: pct(gen.progress),
        creditsEstimate: model.credits ?? null,
      });
      return NextResponse.json({ job }, { status: 201 });
    }

    const [job] = await db
      .insert(mediaJobs)
      .values({
        userId: user.id,
        workspaceId: user.workspaceId,
        campaignId: body.campaignId,
        sourceContentId: body.pieceId,
        meta: styleMeta,
        hedraGenerationId: gen.id,
        hedraAssetId: gen.asset_id,
        elevenAudioAssetId: audioAssetId,
        type: body.type,
        prompt: sanitizeText(body.prompt, 2000),
        modelId: model.id,
        modelName: model.name,
        voiceId: body.voiceId,
        aspectRatio: body.aspectRatio,
        resolution: body.resolution,
        duration: body.duration,
        status: (gen.status as typeof mediaJobs.$inferInsert.status) ?? "queued",
        progress: pct(gen.progress),
        creditsEstimate: model.credits ?? null,
      })
      .returning();

    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
