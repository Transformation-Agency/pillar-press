import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getCredits } from "@/lib/hedra";
import { toErrorResponse } from "@/lib/errors";
import { isLocalFirstMode } from "@/lib/local/mode";
import { requireByokProviderAccess, requireManagedProviderAccess } from "@/lib/billing/entitlements";
import { tenantNotFound } from "@/lib/tenant";

// GET /api/hedra/credits
export async function GET() {
  try {
    const user = await requireUser();
    if (!isLocalFirstMode()) {
      if (!user.workspaceId) return tenantNotFound();
      await requireManagedProviderAccess({ ...user, workspaceId: user.workspaceId });
      return NextResponse.json({
        ok: true,
        configured: Boolean(process.env.HEDRA_API_KEY),
        managed: true,
        credits: null,
      });
    }
    const credits = await getCredits();
    return NextResponse.json(credits);
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
    const credits = await getCredits({ apiKey });
    return NextResponse.json({ ok: true, configured: true, credits });
  } catch (err) {
    return toErrorResponse(err);
  }
}
