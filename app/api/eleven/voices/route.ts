import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listVoices } from "@/lib/elevenlabs";
import { toErrorResponse } from "@/lib/errors";
import { isLocalFirstMode } from "@/lib/local/mode";
import { requireByokProviderAccess, requireManagedProviderAccess } from "@/lib/billing/entitlements";
import { tenantNotFound } from "@/lib/tenant";

function publicVoices(voices: Awaited<ReturnType<typeof listVoices>>) {
  return voices.map((v) => ({ id: v.voice_id, name: v.name, category: v.category, previewUrl: v.preview_url }));
}

// GET /api/eleven/voices  -> available ElevenLabs voices for the voice picker
export async function GET() {
  try {
    const user = await requireUser();
    if (!isLocalFirstMode()) {
      if (!user.workspaceId) return tenantNotFound();
      await requireManagedProviderAccess({ ...user, workspaceId: user.workspaceId });
    }
    const voices = await listVoices();
    // trim to what the UI needs (no secrets in here regardless)
    return NextResponse.json({ voices: publicVoices(voices), source: "elevenlabs" });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!isLocalFirstMode()) {
      if (!user.workspaceId) return tenantNotFound();
      await requireByokProviderAccess({ ...user, workspaceId: user.workspaceId });
    }
    const body = await req.json().catch(() => ({}));
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    const voices = await listVoices({ apiKey });
    return NextResponse.json({ voices: publicVoices(voices), source: "byok" });
  } catch (err) {
    return toErrorResponse(err);
  }
}
