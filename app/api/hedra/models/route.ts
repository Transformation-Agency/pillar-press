import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listModels, type GenerationType } from "@/lib/hedra";
import { FALLBACK_MODELS } from "@/lib/models-fallback";
import { toErrorResponse } from "@/lib/errors";

// GET /api/hedra/models?type=image,video
// Returns live Hedra models (filtered by type), or a fallback catalog so the
// UI still works if the provider list can't be fetched.
export async function GET(req: Request) {
  try {
    await requireUser();
    const url = new URL(req.url);
    const typeParam = url.searchParams.get("type");
    const types = typeParam ? (typeParam.split(",").filter(Boolean) as GenerationType[]) : undefined;
    try {
      const models = await listModels(types);
      return NextResponse.json({ models, source: "hedra" });
    } catch (e) {
      // graceful fallback — log server-side, still serve the UI
      console.warn(JSON.stringify({ level: "warn", msg: "listModels failed, serving fallback" }));
      const models = types ? FALLBACK_MODELS.filter((m) => types.includes(m.type)) : FALLBACK_MODELS;
      return NextResponse.json({ models, source: "fallback" });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
