import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listModels, type GenerationType } from "@/lib/hedra";
import { FALLBACK_MODELS } from "@/lib/models-fallback";
import { toErrorResponse } from "@/lib/errors";
import { isLocalFirstMode } from "@/lib/local/mode";
import { requireManagedProviderAccess } from "@/lib/billing/entitlements";
import { tenantNotFound } from "@/lib/tenant";

function fallbackModels(types: GenerationType[] | undefined) {
  return types ? FALLBACK_MODELS.filter((m) => types.includes(m.type)) : FALLBACK_MODELS;
}

// GET /api/hedra/models?type=image,video
// Returns live Hedra models (filtered by type), or a fallback catalog so the
// UI still works if the provider list can't be fetched.
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const typeParam = url.searchParams.get("type");
    const types = typeParam ? (typeParam.split(",").filter(Boolean) as GenerationType[]) : undefined;
    if (!isLocalFirstMode()) {
      if (!user.workspaceId) return tenantNotFound();
      try {
        await requireManagedProviderAccess({ ...user, workspaceId: user.workspaceId });
      } catch (err) {
        if ((err as { status?: unknown })?.status !== 402) throw err;
        console.warn(JSON.stringify({ level: "warn", msg: "listModels skipped, managed provider unavailable" }));
        return NextResponse.json({ models: fallbackModels(types), source: "fallback", providerAccess: "managed_unavailable" });
      }
    }
    try {
      const models = await listModels(types);
      return NextResponse.json({ models, source: "hedra" });
    } catch (e) {
      // graceful fallback — log server-side, still serve the UI
      console.warn(JSON.stringify({ level: "warn", msg: "listModels failed, serving fallback" }));
      return NextResponse.json({ models: fallbackModels(types), source: "fallback" });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
