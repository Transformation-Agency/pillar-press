import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listVoices } from "@/lib/elevenlabs";
import { toErrorResponse } from "@/lib/errors";

// GET /api/eleven/voices  -> available ElevenLabs voices for the voice picker
export async function GET() {
  try {
    await requireUser();
    const voices = await listVoices();
    // trim to what the UI needs (no secrets in here regardless)
    return NextResponse.json({
      voices: voices.map((v) => ({ id: v.voice_id, name: v.name, category: v.category, previewUrl: v.preview_url })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
