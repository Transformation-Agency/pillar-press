import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { safeRecordAuditEvent } from "@/lib/audit";
import { requireByokProviderAccess } from "@/lib/billing/entitlements";
import { toErrorResponse } from "@/lib/errors";
import { getCredits } from "@/lib/hedra";
import { listVoices } from "@/lib/elevenlabs";
import { isLocalFirstMode } from "@/lib/local/mode";
import {
  getHostedMediaProviderProfile,
  type HostedMediaProviderProfileSecret,
} from "@/lib/mediaProviderSettings";

const bodySchema = z.object({
  profileId: z.string().trim().min(1).max(120),
});

function defaultBaseUrl(provider: HostedMediaProviderProfileSecret["provider"]) {
  if (provider === "openai") return "https://api.openai.com/v1";
  if (provider === "xai") return "https://api.x.ai/v1";
  return "";
}

function profileLabel(profile: HostedMediaProviderProfileSecret) {
  return profile.label || profile.provider;
}

async function testOpenAICompatibleProfile(profile: HostedMediaProviderProfileSecret) {
  const baseUrl = (profile.baseUrl || defaultBaseUrl(profile.provider)).trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return NextResponse.json({
      ok: false,
      error: "Add a base URL before testing this media provider.",
      code: "validation",
    }, { status: 422 });
  }
  const res = await fetch(`${baseUrl}/models`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${profile.apiKey}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    return NextResponse.json({
      ok: false,
      error: "The saved media provider key could not list models.",
      code: "media_provider_test_failed",
    }, { status: res.status === 401 || res.status === 403 ? 401 : 502 });
  }
  const payload = await res.json().catch(() => ({})) as { data?: Array<{ id?: string }>; models?: unknown[] };
  const modelCount = Array.isArray(payload.data)
    ? payload.data.length
    : Array.isArray(payload.models)
      ? payload.models.length
      : 0;
  return NextResponse.json({
    ok: true,
    provider: profile.provider,
    profileId: profile.id,
    label: profileLabel(profile),
    check: { kind: "models", count: modelCount },
  });
}

async function testProfile(profile: HostedMediaProviderProfileSecret) {
  if (!profile.apiKey) {
    return NextResponse.json({
      ok: false,
      error: "This media profile does not have a saved API key.",
      code: "validation",
    }, { status: 422 });
  }
  if (profile.provider === "hedra") {
    const credits = await getCredits({ apiKey: profile.apiKey });
    return NextResponse.json({
      ok: true,
      provider: profile.provider,
      profileId: profile.id,
      label: profileLabel(profile),
      check: { kind: "credits", remaining: credits.remaining ?? null },
    });
  }
  if (profile.provider === "elevenlabs") {
    const voices = await listVoices({ apiKey: profile.apiKey });
    return NextResponse.json({
      ok: true,
      provider: profile.provider,
      profileId: profile.id,
      label: profileLabel(profile),
      check: { kind: "voices", count: voices.length },
    });
  }
  return testOpenAICompatibleProfile(profile);
}

export async function POST(req: Request) {
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
    const profile = await getHostedMediaProviderProfile(user, body.profileId);
    if (!profile) {
      return NextResponse.json({ error: "Media provider profile not found.", code: "not_found" }, { status: 404 });
    }
    const response = await testProfile(profile);
    if (response.ok) {
      await safeRecordAuditEvent({
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: "provider_settings.tested",
        targetType: "provider_secrets",
        targetId: profile.id,
        metadata: {
          kind: "media",
          profileId: profile.id,
          provider: profile.provider,
          ok: true,
        },
      });
    }
    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}
