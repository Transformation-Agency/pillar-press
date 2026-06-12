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
import { getAIForTaskForUser } from "@/lib/llm";
import { generateBodySchema, validateAgainstModel, sanitizeText } from "@/lib/validation";
import { toErrorResponse } from "@/lib/errors";
import {
  getAudioProviderForUser,
  getElevenLabsProviderForUser,
  getHedraProviderForUser,
  getImageProviderForUser,
  type MediaProviderSource,
  type MediaSecretConfig,
} from "@/lib/mediaProviders";
import { generateOpenAICompatibleImage } from "@/lib/mediaImage";
import { generateOpenAICompatibleSpeech } from "@/lib/mediaAudio";
import { campaignInWorkspace, tenantNotFound } from "@/lib/tenant";
import { completeUsageReservation, failUsageReservation, reserveUsage, type UsageReservation } from "@/lib/billing/usage";
import { requireByokProviderAccess, requireConcurrentJobCapacity, requireManagedProviderAccess } from "@/lib/billing/entitlements";
import type { SessionUser } from "@/lib/auth";
import type { Piece } from "@/lib/db";

/** Trim a piece down to a prompt-sized excerpt for image grounding. */
function pieceExcerpt(p: { original?: string | null; revision?: unknown } | undefined): string {
  if (!p) return "";
  const rev = p.revision as { text?: string } | null | undefined;
  const text = (rev?.text || p.original || "").replace(/\s+/g, " ").trim();
  return text.slice(0, 700);
}

const pct = (p: number | undefined) => (p == null ? 0 : Math.round(p <= 1 ? p * 100 : p));

async function resolvePieceForTenant(id: string | null | undefined, user: SessionUser): Promise<Piece | null> {
  if (!id) return null;
  if (isLocalFirstMode()) return getLocalPiece(id, user.id, user.workspaceId) as Piece | null;
  const piece = await db.query.pieces.findFirst({
    where: and(eq(pieces.id, id), eq(pieces.userId, user.id)),
  });
  if (!piece || !(await campaignInWorkspace(piece.campaignId, user.workspaceId))) return null;
  return piece as Piece;
}

/**
 * A start image can arrive as a raw Hedra asset id, an http(s) URL (a library
 * image), or a data: URL (an uploaded file). Hedra's start_keyframe_id needs an
 * asset id, so anything URL-shaped is fetched and uploaded first.
 */
async function resolveStartAsset(ref: string | undefined, hedraApiKey?: string): Promise<string | undefined> {
  if (!ref) return undefined;
  const isUrl = ref.startsWith("http://") || ref.startsWith("https://") || ref.startsWith("data:");
  if (!isUrl) return ref; // already an asset id
  const resp = await fetch(ref);
  if (!resp.ok) throw new Error("Could not load the start image.");
  const blob = await resp.blob();
  const ext = (blob.type && blob.type.split("/")[1]) || "png";
  const name = `start-frame-${Date.now()}.${ext}`;
  const asset = await createAsset({ name, type: "image" }, { apiKey: hedraApiKey });
  await uploadAsset(asset.id, blob, name, { apiKey: hedraApiKey });
  return asset.id;
}

function profileMetadata(config: { providerSource?: MediaProviderSource; profileId?: string } | null | undefined) {
  return {
    providerSource: config?.providerSource ?? "managed",
    ...(config?.profileId ? { profileId: config.profileId } : {}),
  };
}

function combinedSource(primary: MediaSecretConfig | null, secondary: MediaSecretConfig | null): MediaProviderSource {
  return primary?.providerSource === "byok" && (!secondary || secondary.providerSource === "byok")
    ? "byok"
    : "managed";
}

async function requireMediaProviderAccessForSource(user: SessionUser, providerSource: MediaProviderSource) {
  if (isLocalFirstMode() || !user.workspaceId) return;
  const billingUser = { ...user, workspaceId: user.workspaceId };
  if (providerSource === "byok") await requireByokProviderAccess(billingUser);
  else await requireManagedProviderAccess(billingUser);
}

// POST /api/hedra/generate
// - audio: ElevenLabs TTS rendered to an inline data URL (no Hedra), persisted
//   as a completed job.
// - image: flat Hedra text-to-image (poll status; the asset carries the URL).
// - video / avatar_video: Hedra video; avatar/video with a script first renders
//   TTS on ElevenLabs and uploads it to Hedra as the audio track.
export async function POST(req: Request) {
  let reservation: UsageReservation = null;
  try {
    const user = await requireUser();
    const body = generateBodySchema.parse(await req.json());
    if (body.campaignId && !(await campaignInWorkspace(body.campaignId, user.workspaceId))) return tenantNotFound();
    const scopedPiece = body.pieceId ? await resolvePieceForTenant(body.pieceId, user) : null;
    if (body.pieceId && !scopedPiece) return tenantNotFound();
    if (!isLocalFirstMode() && user.workspaceId) {
      await requireConcurrentJobCapacity({ ...user, workspaceId: user.workspaceId });
    }

    // ── Audio (ElevenLabs TTS) — no Hedra model involved ───────────────────
    if (body.type === "audio") {
      const script = sanitizeText(body.script || body.prompt, 100000);
      if (!script) return NextResponse.json({ error: "Provide a script to voice.", code: "validation" }, { status: 422 });

      const audioProvider = await getAudioProviderForUser(body.provider, user);
      const elevenProvider = audioProvider ? null : await getElevenLabsProviderForUser(user);
      const usageSource = audioProvider?.providerSource ?? elevenProvider?.providerSource ?? "managed";
      const usageProfileId = audioProvider?.profileId ?? elevenProvider?.profileId;
      reservation = await reserveUsage({
        user,
        task: "media_generation",
        feature: "media.audio",
        campaignId: body.campaignId,
        pieceId: body.pieceId,
        providerSource: usageSource,
        provider: audioProvider?.provider ?? "elevenlabs",
        model: body.modelId,
        metadata: usageProfileId ? { profileId: usageProfileId } : {},
      });
      let audioUrl: string;
      let audioVoice = body.voiceId;
      const meta: Record<string, unknown> = {};
      if (audioProvider) {
        const result = await generateOpenAICompatibleSpeech({
          config: audioProvider,
          model: body.modelId,
          text: script,
          voice: body.voiceId,
          user,
        });
        audioUrl = result.outputUrl;
        audioVoice = result.voice;
        meta.provider = audioProvider.provider;
        Object.assign(meta, profileMetadata(audioProvider));
      } else {
        if (!body.voiceId) return NextResponse.json({ error: "Pick a voice.", code: "validation" }, { status: 422 });
        // Long scripts are chunked + stitched, then stored (an inline data URL
        // would exceed the serverless response limit). Fall back to inline only
        // for small clips when storage isn't configured (e.g. local dev).
        const buf = await textToSpeechLong({ text: script, voiceId: body.voiceId, apiKey: elevenProvider?.apiKey });
        try {
          audioUrl = await uploadPublicAudio(buf, `voiceover-${Date.now()}.mp3`, { user });
        } catch (e) {
          if (buf.length <= 4_000_000) audioUrl = `data:audio/mpeg;base64,${buf.toString("base64")}`;
          else throw e;
        }
        meta.provider = "elevenlabs";
        Object.assign(meta, profileMetadata(elevenProvider));
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
        await completeUsageReservation(reservation);
        return NextResponse.json({ job }, { status: 201 });
      }

      const [job] = await db
        .insert(mediaJobs)
        .values(jobValues)
        .returning();
      await completeUsageReservation(reservation);
      return NextResponse.json({ job }, { status: 201 });
    }

    // ── OpenAI-compatible image providers ─────────────────────────────────
    const imageProvider = await getImageProviderForUser(body.provider, user);
    if (body.type === "image" && imageProvider) {
      const prompt = sanitizeText(body.prompt, 2000);
      if (!prompt) return NextResponse.json({ error: "Provide an image prompt.", code: "validation" }, { status: 422 });

      reservation = await reserveUsage({
        user,
        task: "media_generation",
        feature: "media.image",
        campaignId: body.campaignId,
        pieceId: body.pieceId,
        providerSource: imageProvider.providerSource ?? "managed",
        provider: imageProvider.provider,
        model: body.modelId,
        metadata: imageProvider.profileId ? { profileId: imageProvider.profileId } : {},
      });
      const result = await generateOpenAICompatibleImage({
        config: imageProvider,
        model: body.modelId,
        prompt,
        aspectRatio: body.aspectRatio,
        resolution: body.resolution,
        user,
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
        meta: {
          provider: imageProvider.provider,
          providerResponseId: result.providerResponseId ?? null,
          ...profileMetadata(imageProvider),
        },
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
        await completeUsageReservation(reservation, {
          metadata: { providerResponseId: result.providerResponseId ?? null },
        });
        return NextResponse.json({ job }, { status: 201 });
      }

      const [job] = await db
        .insert(mediaJobs)
        .values(jobValues)
        .returning();
      await completeUsageReservation(reservation, {
        metadata: { providerResponseId: result.providerResponseId ?? null },
      });
      return NextResponse.json({ job }, { status: 201 });
    }

    // ── Image / Video / Avatar (Hedra) ─────────────────────────────────────
    const wanted: GenerationType = body.type === "avatar_video" ? "video" : (body.type as GenerationType);
    const hedraProvider = await getHedraProviderForUser(user);
    const needsVoiceover = !body.audioAssetId && Boolean(body.script) && (body.type === "avatar_video" || body.type === "video");
    const voiceoverProvider = needsVoiceover ? await getElevenLabsProviderForUser(user) : null;
    const providerSource = combinedSource(hedraProvider, voiceoverProvider);
    await requireMediaProviderAccessForSource(user, providerSource);
    const models = await listModels([wanted], { apiKey: hedraProvider?.apiKey });
    const model = models.find((m) => m.id === body.modelId);
    if (!model) return NextResponse.json({ error: "Unknown or unavailable model.", code: "bad_request" }, { status: 400 });

    const reqErr = validateAgainstModel(body, model);
    if (reqErr) return NextResponse.json({ error: reqErr, code: "validation" }, { status: 422 });

    reservation = await reserveUsage({
      user,
      task: "media_generation",
      feature: `media.${body.type}`,
      campaignId: body.campaignId,
      pieceId: body.pieceId,
      providerSource,
      provider: "hedra",
      model: body.modelId,
      metadata: {
        ...(hedraProvider?.profileId ? { profileId: hedraProvider.profileId, hedraProfileId: hedraProvider.profileId } : {}),
        ...(voiceoverProvider?.profileId ? { elevenlabsProfileId: voiceoverProvider.profileId } : {}),
      },
    });

    let audioAssetId = body.audioAssetId;

    // Combine: use an EXISTING audio media item as the video's audio track —
    // fetch its bytes and upload them to Hedra as an audio asset.
    if (!audioAssetId && body.audioMediaId && (body.type === "avatar_video" || body.type === "video")) {
      const am = isLocalFirstMode()
        ? getLocalMediaJob(body.audioMediaId, user.id)
        : await db.query.mediaJobs.findFirst({
            where: user.workspaceId
              ? and(eq(mediaJobs.id, body.audioMediaId), eq(mediaJobs.userId, user.id), eq(mediaJobs.workspaceId, user.workspaceId))
              : and(eq(mediaJobs.id, body.audioMediaId), eq(mediaJobs.userId, user.id)),
          });
      if (!am) return tenantNotFound();
      if (am && user.workspaceId && am.workspaceId && am.workspaceId !== user.workspaceId) return tenantNotFound();
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
      const aasset = await createAsset({ name: aname, type: "audio" }, { apiKey: hedraProvider?.apiKey });
      await uploadAsset(aasset.id, new Blob([new Uint8Array(abytes)], { type: "audio/mpeg" }), aname, { apiKey: hedraProvider?.apiKey });
      audioAssetId = aasset.id;
    }

    // Voiceover for avatar/synced video: render TTS and upload it to Hedra.
    if (!audioAssetId && body.script && (body.type === "avatar_video" || body.type === "video")) {
      const buf = await textToSpeechLong({
        text: sanitizeText(body.script, 100000),
        voiceId: body.voiceId ?? "",
        apiKey: voiceoverProvider?.apiKey,
      });
      const asset = await createAsset({ name: `voiceover-${Date.now()}.mp3`, type: "audio" }, { apiKey: hedraProvider?.apiKey });
      await uploadAsset(
        asset.id,
        new Blob([new Uint8Array(buf)], { type: "audio/mpeg" }),
        `voiceover-${Date.now()}.mp3`,
        { apiKey: hedraProvider?.apiKey },
      );
      audioAssetId = asset.id;
    }

    const input: GenerateInput = {
      type: model.type === "image" ? "image" : "video",
      modelId: model.id,
      textPrompt: sanitizeText(body.prompt, 2000) || sanitizeText(body.script, 2000) || undefined,
      aspectRatio: body.aspectRatio,
      resolution: body.resolution,
      startAssetId: await resolveStartAsset(body.startAssetId, hedraProvider?.apiKey),
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
    meta.provider = "hedra";
    Object.assign(meta, profileMetadata(hedraProvider));
    if (hedraProvider?.profileId) meta.hedraProfileId = hedraProvider.profileId;
    if (voiceoverProvider?.profileId) meta.elevenlabsProfileId = voiceoverProvider.profileId;
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
        const pc = scopedPiece;
        if (pc) article = { title: pc.title, excerpt: pieceExcerpt(pc) };
      }
      const taskAI = await getAIForTaskForUser("mediaPrompt", user);
      const enhanced = await craftImagePrompt({
        seed: sanitizeText(body.prompt, 2000),
        styleDirective: prof?.directive || "",
        refContext: refCtx,
        article,
      }, taskAI.ai);
      input.textPrompt = enhanced || input.textPrompt;
      meta.enhancedPrompt = enhanced;
    } else if (prof?.directive && !body.directed) {
      // Non-enhanced path (video/avatar, or image with enhance off): keep the
      // learned directive prepended so the look still carries. Skipped when the
      // prompt is already an art-directed one sent verbatim (it has the style).
      input.textPrompt = input.textPrompt ? `${prof.directive}\n\n${input.textPrompt}` : prof.directive;
    }

    const styleMeta = Object.keys(meta).length ? meta : undefined;
    const gen = await generateAsset(input, { apiKey: hedraProvider?.apiKey });

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
      await completeUsageReservation(reservation, {
        actualCredits: Math.max(1, Math.ceil(model.credits ?? 1)),
        providerRequestId: gen.id,
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

    await completeUsageReservation(reservation, {
      actualCredits: Math.max(1, Math.ceil(model.credits ?? 1)),
      providerRequestId: gen.id,
    });
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    await failUsageReservation(reservation, err);
    return toErrorResponse(err);
  }
}
