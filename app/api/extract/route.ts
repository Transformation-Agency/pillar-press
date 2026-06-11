import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { extractFileText } from "@/lib/ai/fileExtract";
import { toErrorResponse } from "@/lib/errors";
import { completeUsageReservation, failUsageReservation, reserveUsage, type UsageReservation } from "@/lib/billing/usage";

export const runtime = "nodejs"; // needs Buffer + mammoth (not edge)
export const maxDuration = 60; // PDF/image extraction via the model can take a while

// ~4.5MB serverless request-body limit on Vercel; cap a bit under it.
const MAX_BYTES = 4.4 * 1024 * 1024;

function usesModelBackedExtraction(file: File) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const mime = (file.type || "").toLowerCase();
  return mime === "application/pdf" || ext === "pdf" || mime.startsWith("image/") || /^(png|jpe?g|gif|webp)$/i.test(ext);
}

/**
 * POST /api/extract  (multipart form-data, field "file")
 * Returns { name, text } — the file's content as research text. Handles PDFs,
 * images (vision), .docx, and text files. Used by Weave + Workspace uploads.
 */
export async function POST(req: Request) {
  let reservation: UsageReservation = null;
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded.", code: "bad_request" }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) {
      return NextResponse.json({ error: "That file is empty.", code: "validation" }, { status: 422 });
    }
    if (bytes.length > MAX_BYTES) {
      return NextResponse.json(
        { error: "File too large (max ~4MB). Compress or split it and try again.", code: "too_large" },
        { status: 413 },
      );
    }
    if (usesModelBackedExtraction(file)) {
      reservation = await reserveUsage({
        user,
        task: "file_extract",
        feature: "file.extract",
        estimatedCredits: 1,
        metadata: { mimeType: file.type || null, size: bytes.length },
      });
    }
    const text = await extractFileText({ name: file.name, mimeType: file.type, bytes });
    if (!text.trim()) {
      await failUsageReservation(reservation, new Error("File extraction returned no text."));
      return NextResponse.json({ error: "Couldn't read any text from that file.", code: "validation" }, { status: 422 });
    }
    await completeUsageReservation(reservation);
    return NextResponse.json({ name: file.name, text });
  } catch (err) {
    await failUsageReservation(reservation, err);
    return toErrorResponse(err);
  }
}
