import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db, references, pieces } from "@/lib/db";
import { buildRefContext, type ReferencesDoc } from "@/lib/refContext";
import { craftVoiceScript } from "@/lib/ai/voiceScript";
import { toErrorResponse } from "@/lib/errors";

const bodySchema = z.object({
  pieceId: z.string().uuid(),
  campaignId: z.string().optional(),
  voiceName: z.string().max(120).optional(),
});

/** The canonical text to voice: the accepted/revised draft if present, else the original. */
function pieceText(p: { original?: string | null; revision?: unknown } | undefined): string {
  if (!p) return "";
  const rev = p.revision as { text?: string } | null | undefined;
  return (rev?.text || p.original || "").trim().slice(0, 12000);
}

// POST /api/hedra/voice-script — generate an ElevenLabs-ready voiceover script
// from the linked piece (no Hedra/ElevenLabs credits spent here; just the text
// adaptation). Returns { script } for the Studio's Voice "Generate script".
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = bodySchema.parse(await req.json());

    const piece = await db.query.pieces.findFirst({
      where: and(eq(pieces.id, body.pieceId), eq(pieces.userId, user.id)),
    });
    if (!piece) return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

    const text = pieceText(piece);
    if (!text) return NextResponse.json({ error: "This piece has no text to voice yet.", code: "validation" }, { status: 422 });

    let refCtx = "";
    if (body.campaignId) {
      const ref = await db.query.references.findFirst({ where: eq(references.campaignId, body.campaignId) });
      refCtx = buildRefContext((ref?.doc as ReferencesDoc | undefined) ?? null);
    }

    const script = await craftVoiceScript({
      article: { title: piece.title, text },
      refContext: refCtx,
      voiceName: body.voiceName,
    });

    return NextResponse.json({ script });
  } catch (err) {
    return toErrorResponse(err);
  }
}
