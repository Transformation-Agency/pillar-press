import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAsset, uploadAsset } from "@/lib/hedra";
import { validateUpload, sanitizeFilename } from "@/lib/validation";
import { toErrorResponse } from "@/lib/errors";

// POST /api/hedra/assets   (multipart/form-data: file, kind=image|audio)
// Validates type/size, registers a Hedra asset, uploads the bytes, returns the
// asset id for use as a start frame / audio track in /generate.
export async function POST(req: Request) {
  try {
    await requireUser();
    const form = await req.formData();
    const file = form.get("file");
    const kind = (form.get("kind") as string) === "audio" ? "audio" : "image";
    if (!(file instanceof File)) return NextResponse.json({ error: "No file.", code: "bad_request" }, { status: 400 });

    const err = validateUpload({ type: file.type, size: file.size }, kind);
    if (err) return NextResponse.json({ error: err, code: "validation" }, { status: 422 });

    const name = sanitizeFilename(file.name);
    const asset = await createAsset({ name, type: kind });
    const uploaded = await uploadAsset(asset.id, file, name);
    return NextResponse.json({ asset: uploaded }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
