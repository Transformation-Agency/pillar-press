import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/errors";
import { isLocalFirstMode } from "@/lib/local/mode";
import { safeRecordAuditEvent } from "@/lib/audit";
import {
  getHostedProviderSettings,
  saveHostedProviderSettings,
} from "@/lib/providerSettings";
import { LLM_TASKS } from "@/lib/llm/config";
import { requireByokProviderAccess } from "@/lib/billing/entitlements";

const providerSchema = z.enum(["anthropic", "openai", "openai-compatible", "xai", "ollama", "gemini"]);

const profileSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().max(160).optional(),
  provider: providerSchema,
  model: z.string().trim().min(1).max(200),
  baseUrl: z.string().trim().max(500).optional(),
  apiKey: z.string().trim().max(4000).optional(),
});

const taskDefaultsSchema = z
  .record(z.enum(LLM_TASKS as [typeof LLM_TASKS[number], ...typeof LLM_TASKS[number][]]), z.string().trim().min(1).max(120))
  .optional();

const bodySchema = z.object({
  settings: z.object({
    provider: providerSchema.optional(),
    model: z.string().trim().max(200).optional(),
    baseUrl: z.string().trim().max(500).optional(),
    apiKey: z.string().trim().max(4000).optional(),
    profiles: z.array(profileSchema).max(20).optional(),
    defaultProfileId: z.string().trim().max(120).optional(),
    taskDefaults: taskDefaultsSchema,
  }),
});

export async function GET() {
  try {
    const user = await requireUser();
    if (isLocalFirstMode()) {
      return NextResponse.json({ settings: { profiles: [], defaultProfileId: null, taskDefaults: {} } });
    }
    return NextResponse.json({ settings: await getHostedProviderSettings(user) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    if (isLocalFirstMode()) {
      return NextResponse.json({ error: "Desktop provider settings are stored by the desktop app.", code: "local_first" }, { status: 409 });
    }
    const body = bodySchema.parse(await req.json());
    if (!user.workspaceId) {
      return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    }
    await requireByokProviderAccess({ ...user, workspaceId: user.workspaceId });
    const settings = await saveHostedProviderSettings(user, body.settings);
    await safeRecordAuditEvent({
      workspaceId: user.workspaceId,
      actorId: user.id,
      action: "provider_settings.updated",
      targetType: "provider_secrets",
      metadata: {
        kind: "llm",
        profileCount: settings.profiles.length,
        defaultProfileId: settings.defaultProfileId ?? null,
        taskDefaultCount: Object.keys(settings.taskDefaults ?? {}).length,
        profiles: settings.profiles.map((profile) => ({
          id: profile.id,
          provider: profile.provider,
          model: profile.model,
          hasApiKey: profile.hasApiKey,
        })),
      },
    });
    return NextResponse.json({ settings });
  } catch (err) {
    return toErrorResponse(err);
  }
}
