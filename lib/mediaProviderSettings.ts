import { and, eq } from "drizzle-orm";
import { db, providerSecrets, type ProviderSecret } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { decryptHostedSecret, encryptHostedSecret } from "@/lib/providerSettings";

const MEDIA_PROVIDERS = ["hedra", "elevenlabs", "openai", "xai", "custom-image"] as const;
export type MediaProvider = typeof MEDIA_PROVIDERS[number];

export type HostedMediaProviderProfileInput = {
  id: string;
  label?: string;
  provider: MediaProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
};

export type HostedMediaProviderSettingsInput = {
  profiles?: HostedMediaProviderProfileInput[];
  defaultProfileId?: string;
};

export type HostedMediaProviderProfileView = {
  id: string;
  label?: string;
  provider: MediaProvider;
  model?: string;
  baseUrl?: string;
  hasApiKey: boolean;
};

export type HostedMediaProviderProfileSecret = HostedMediaProviderProfileView & {
  apiKey?: string;
};

export type HostedMediaProviderSettingsView = {
  profiles: HostedMediaProviderProfileView[];
  defaultProfileId: string | null;
};

function trim(value: string | undefined | null) {
  const next = value?.trim();
  return next || undefined;
}

function validProvider(provider: string | undefined): provider is MediaProvider {
  return (MEDIA_PROVIDERS as readonly string[]).includes(provider ?? "");
}

function scope(user: Pick<SessionUser, "id" | "workspaceId">) {
  if (!user.workspaceId) throw new Error("Hosted media provider settings require a workspace.");
  return and(
    eq(providerSecrets.workspaceId, user.workspaceId),
    eq(providerSecrets.userId, user.id),
    eq(providerSecrets.kind, "media"),
  );
}

function rowToView(row: ProviderSecret): HostedMediaProviderProfileView {
  return {
    id: row.profileId,
    label: row.label ?? undefined,
    provider: row.provider as MediaProvider,
    model: row.model ?? undefined,
    baseUrl: row.baseUrl ?? undefined,
    hasApiKey: row.hasApiKey,
  };
}

function rowToSecret(row: ProviderSecret): HostedMediaProviderProfileSecret {
  return {
    ...rowToView(row),
    apiKey: decryptHostedSecret(row.encryptedApiKey),
  };
}

function validRows(rows: ProviderSecret[]) {
  return rows.filter((row) => validProvider(row.provider));
}

export async function getHostedMediaProviderSettings(
  user: Pick<SessionUser, "id" | "workspaceId">,
): Promise<HostedMediaProviderSettingsView> {
  const rows = validRows(await db.select().from(providerSecrets).where(scope(user)));
  const defaultRow = rows.find((row) => row.isDefault) ?? rows[0] ?? null;
  return {
    profiles: rows.map(rowToView),
    defaultProfileId: defaultRow?.profileId ?? null,
  };
}

export async function getHostedMediaProviderProfile(
  user: Pick<SessionUser, "id" | "workspaceId">,
  profileId: string | undefined | null,
): Promise<HostedMediaProviderProfileSecret | null> {
  const rows = validRows(await db.select().from(providerSecrets).where(scope(user)));
  const row = profileId
    ? rows.find((item) => item.profileId === profileId)
    : rows.find((item) => item.isDefault) ?? rows[0];
  return row ? rowToSecret(row) : null;
}

export async function getHostedMediaProviderProfileForProvider(
  user: Pick<SessionUser, "id" | "workspaceId">,
  provider: MediaProvider,
): Promise<HostedMediaProviderProfileSecret | null> {
  const rows = validRows(await db.select().from(providerSecrets).where(scope(user)));
  const row = rows.find((item) => item.provider === provider && item.isDefault)
    ?? rows.find((item) => item.provider === provider);
  return row ? rowToSecret(row) : null;
}

export async function saveHostedMediaProviderSettings(
  user: Pick<SessionUser, "id" | "workspaceId">,
  settings: HostedMediaProviderSettingsInput,
): Promise<HostedMediaProviderSettingsView> {
  if (!user.workspaceId) throw new Error("Hosted media provider settings require a workspace.");
  const profiles = Array.isArray(settings.profiles) ? settings.profiles : [];
  const defaultProfileId = trim(settings.defaultProfileId) || profiles[0]?.id;

  for (const profile of profiles) {
    const id = trim(profile.id);
    if (!id || !validProvider(profile.provider)) continue;
    const [existing] = await db
      .select()
      .from(providerSecrets)
      .where(and(scope(user), eq(providerSecrets.profileId, id)))
      .limit(1);
    const encryptedApiKey = trim(profile.apiKey)
      ? encryptHostedSecret(profile.apiKey!)
      : existing?.encryptedApiKey ?? null;
    const hasApiKey = Boolean(encryptedApiKey);
    const values = {
      workspaceId: user.workspaceId,
      userId: user.id,
      kind: "media",
      profileId: id,
      label: trim(profile.label) ?? null,
      provider: profile.provider,
      model: trim(profile.model) ?? null,
      baseUrl: trim(profile.baseUrl) ?? null,
      encryptedApiKey,
      hasApiKey,
      isDefault: id === defaultProfileId,
      taskDefaults: {},
      updatedAt: new Date(),
    };

    await db
      .insert(providerSecrets)
      .values(values)
      .onConflictDoUpdate({
        target: [
          providerSecrets.workspaceId,
          providerSecrets.userId,
          providerSecrets.kind,
          providerSecrets.profileId,
        ],
        set: values,
      });
  }

  return getHostedMediaProviderSettings(user);
}
