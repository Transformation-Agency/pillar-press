import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { requireByokProviderAccess } from "@/lib/billing/entitlements";
import { toErrorResponse } from "@/lib/errors";
import { isLocalFirstMode } from "@/lib/local/mode";
import { safeRecordAuditEvent } from "@/lib/audit";
import {
  getHostedMediaProviderSettings,
  saveHostedMediaProviderSettings,
} from "@/lib/mediaProviderSettings";

const mediaProviderSchema = z.enum(["hedra", "elevenlabs", "openai", "xai", "custom-image"]);

const profileSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().max(160).optional(),
  provider: mediaProviderSchema,
  model: z.string().trim().max(200).optional(),
  baseUrl: z.string().trim().max(500).optional(),
  apiKey: z.string().trim().max(4000).optional(),
});

const bodySchema = z.object({
  settings: z.object({
    profiles: z.array(profileSchema).max(20).optional(),
    defaultProfileId: z.string().trim().max(120).optional(),
  }),
});

export async function GET() {
  try {
    const user = await requireUser();
    if (isLocalFirstMode()) {
      return NextResponse.json({ settings: { profiles: [], defaultProfileId: null } });
    }
    return NextResponse.json({ settings: await getHostedMediaProviderSettings(user) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    if (isLocalFirstMode()) {
      return NextResponse.json({ error: "Desktop media provider settings are stored by the desktop app.", code: "local_first" }, { status: 409 });
    }
    if (!user.workspaceId) {
      return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    }
    await requireByokProviderAccess({ ...user, workspaceId: user.workspaceId });
    const body = bodySchema.parse(await req.json());
    const settings = await saveHostedMediaProviderSettings(user, body.settings);
    await safeRecordAuditEvent({
      workspaceId: user.workspaceId,
      actorId: user.id,
      action: "provider_settings.updated",
      targetType: "provider_secrets",
      metadata: {
        kind: "media",
        profileCount: settings.profiles.length,
        defaultProfileId: settings.defaultProfileId ?? null,
        profiles: settings.profiles.map((profile) => ({
          id: profile.id,
          provider: profile.provider,
          model: profile.model ?? null,
          hasApiKey: profile.hasApiKey,
        })),
      },
    });
    return NextResponse.json({ settings });
  } catch (err) {
    return toErrorResponse(err);
  }
}
