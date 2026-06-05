import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db, mediaJobs } from "@/lib/db";
import {
  listModels, generateAsset, createAsset, uploadAsset, type GenerateInput, type GenerationType,
} from "@/lib/hedra";
import { textToSpeech } from "@/lib/elevenlabs";
import { generateBodySchema, validateAgainstModel, sanitizeText } from "@/lib/validation";
import { toErrorResponse } from "@/lib/errors";

// POST /api/hedra/generate
// Validates the request, performs the (optional) ElevenLabs voiceover ->
// Hedra audio asset step for avatar/synced video, kicks off the Hedra
// generation, persists a media_jobs row, and returns it. The client then
// polls /api/hedra/status/[id] until terminal.
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = generateBodySchema.parse(await req.json());

    // 1) resolve model metadata from the LIVE list (never trust client capabilities)
    const wanted: GenerationType = body.type === "avatar_video" ? "video" : (body.type as GenerationType);
    const models = await listModels([wanted]);
    const model = models.find((m) => m.id === body.modelId);
    if (!model) return NextResponse.json({ error: "Unknown or unavailable model.", code: "bad_request" }, { status: 400 });

    const reqErr = validateAgainstModel(body, model);
    if (reqErr) return NextResponse.json({ error: reqErr, code: "validation" }, { status: 422 });

    // 2) voiceover: if avatar/synced video with a script but no audio asset,
    //    render TTS on ElevenLabs and upload it to Hedra as an audio asset.
    let audioAssetId = body.audioAssetId;
    if (!audioAssetId && body.script && (body.type === "avatar_video" || body.type === "video")) {
      const audio = await textToSpeech({ text: body.script, voiceId: body.voiceId ?? "" });
      const asset = await createAsset({ name: `voiceover-${Date.now()}.mp3`, type: "audio" });
      await uploadAsset(asset.id, audio, `voiceover-${Date.now()}.mp3`);
      audioAssetId = asset.id;
    }

    // 3) kick off the Hedra generation
    const input: GenerateInput = {
      type: model.type,
      model_id: model.id,
      prompt: sanitizeText(body.prompt, 2000) || undefined,
      start_asset_id: body.startAssetId,
      end_asset_id: body.endAssetId,
      audio_asset_id: audioAssetId,
      aspect_ratio: body.aspectRatio,
      resolution: body.resolution,
      duration: body.duration,
    };
    const gen = await generateAsset(input);

    // 4) persist the job, scoped to this user
    const [job] = await db
      .insert(mediaJobs)
      .values({
        userId: user.id,
        workspaceId: user.workspaceId,
        sourceContentId: body.pieceId,
        hedraGenerationId: gen.id,
        elevenAudioAssetId: audioAssetId,
        type: body.type,
        prompt: sanitizeText(body.prompt, 2000),
        modelId: model.id,
        modelName: model.name,
        voiceId: body.voiceId,
        aspectRatio: body.aspectRatio,
        resolution: body.resolution,
        duration: body.duration,
        status: (gen.status as any) ?? "queued",
        progress: gen.progress ?? 0,
        creditsEstimate: model.credits ?? null,
      })
      .returning();

    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
