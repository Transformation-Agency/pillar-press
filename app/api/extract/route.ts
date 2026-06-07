import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { extractFileText } from "@/lib/ai/fileExtract";
import { toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs"; // needs Buffer + mammoth (not edge)
export const maxDuration = 60; // PDF/image extraction via the model can take a while

// ~4.5MB serverless request-body limit on Vercel; cap a bit under it.
const MAX_BYTES = 4.4 * 1024 * 1024;

/**
 * POST /api/extract  (multipart form-data, field "file")
 * Returns { name, text } — the file's content as research text. Handles PDFs,
 * images (vision), .docx, and text files. Used by Weave + Workspace uploads.
 */
export async function POST(req: Request) {
  try {
    await requireUser();
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
    const text = await extractFileText({ name: file.name, mimeType: file.type, bytes });
    if (!text.trim()) {
      return NextResponse.json({ error: "Couldn't read any text from that file.", code: "validation" }, { status: 422 });
    }
    return NextResponse.json({ name: file.name, text });
  } catch (err) {
    return toErrorResponse(err);
  }
}
