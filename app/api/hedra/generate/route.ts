import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db, mediaJobs } from "@/lib/db";
import {
  listModels, generateAsset, createAsset, uploadAsset, type GenerateInput, type GenerationType,
} from "@/lib/hedra";
import { textToSpeech } from "@/lib/elevenlabs";
import { generateBodySchema, validateAgainstModel, sanitizeText } from "@/lib/validation";
import { toErrorResponse } from "@/lib/errors";

const pct = (p: number | undefined) => (p == null ? 0 : Math.round(p <= 1 ? p * 100 : p));

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
      const script = sanitizeText(body.script || body.prompt, 5000);
      if (!script) return NextResponse.json({ error: "Provide a script to voice.", code: "validation" }, { status: 422 });
      if (!body.voiceId) return NextResponse.json({ error: "Pick a voice.", code: "validation" }, { status: 422 });

      const audio = await textToSpeech({ text: script, voiceId: body.voiceId });
      const buf = Buffer.from(await audio.arrayBuffer());
      const dataUrl = `data:audio/mpeg;base64,${buf.toString("base64")}`;

      const [job] = await db
        .insert(mediaJobs)
        .values({
          userId: user.id,
          workspaceId: user.workspaceId,
          sourceContentId: body.pieceId,
          type: "audio",
          prompt: script.slice(0, 2000),
          modelId: body.modelId,
          voiceId: body.voiceId,
          status: "completed",
          progress: 100,
          outputUrl: dataUrl,
          downloadUrl: dataUrl,
          completedAt: new Date(),
        })
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

    // Voiceover for avatar/synced video: render TTS and upload it to Hedra.
    let audioAssetId = body.audioAssetId;
    if (!audioAssetId && body.script && (body.type === "avatar_video" || body.type === "video")) {
      const audio = await textToSpeech({ text: sanitizeText(body.script, 5000), voiceId: body.voiceId ?? "" });
      const asset = await createAsset({ name: `voiceover-${Date.now()}.mp3`, type: "audio" });
      await uploadAsset(asset.id, audio, `voiceover-${Date.now()}.mp3`);
      audioAssetId = asset.id;
    }

    const input: GenerateInput = {
      type: model.type === "image" ? "image" : "video",
      modelId: model.id,
      textPrompt: sanitizeText(body.prompt, 2000) || sanitizeText(body.script, 2000) || undefined,
      aspectRatio: body.aspectRatio,
      resolution: body.resolution,
      startAssetId: body.startAssetId,
      audioAssetId,
      durationMs: body.duration ? body.duration * 1000 : undefined,
    };
    const gen = await generateAsset(input);

    const [job] = await db
      .insert(mediaJobs)
      .values({
        userId: user.id,
        workspaceId: user.workspaceId,
        sourceContentId: body.pieceId,
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
