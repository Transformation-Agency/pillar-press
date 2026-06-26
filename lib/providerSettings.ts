import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, providerSecrets, type ProviderSecret } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { normalizeHostedProviderBaseUrl } from "@/lib/hostedProviderUrls";
import type { LLMProvider, LLMTask } from "@/lib/llm/types";
import { LLM_TASKS } from "@/lib/llm/config";

const HOSTED_SECRET_PREFIX = "kphost:v1:";
const PROVIDERS = new Set<LLMProvider>(["anthropic", "openai", "openai-compatible", "xai", "ollama", "gemini"]);

export type HostedProviderProfileInput = {
  id: string;
  label?: string;
  provider: LLMProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
};

export type HostedProviderSettingsInput = {
  provider?: LLMProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  profiles?: HostedProviderProfileInput[];
  defaultProfileId?: string;
  taskDefaults?: Partial<Record<LLMTask, string>>;
};

export type HostedProviderProfileView = {
  id: string;
  label?: string;
  provider: LLMProvider;
  model: string;
  baseUrl?: string;
  hasApiKey: boolean;
};

export type HostedProviderProfileSecret = HostedProviderProfileView & {
  apiKey?: string;
};

export type HostedProviderSettingsView = {
  profiles: HostedProviderProfileView[];
  defaultProfileId: string | null;
  taskDefaults: Partial<Record<LLMTask, string>>;
};

function trim(value: string | undefined | null) {
  const next = value?.trim();
  return next || undefined;
}

function hostedSecretKey(env: NodeJS.ProcessEnv = process.env) {
  const raw =
    trim(env.PILLAR_PRESS_HOSTED_SECRET_KEY) ||
    trim(env.PILLAR_PRESS_ENCRYPTION_KEY) ||
    trim(env.AUTH_SECRET);
  if (!raw) {
    throw new Error("Missing PILLAR_PRESS_HOSTED_SECRET_KEY for hosted provider key encryption.");
  }
  if (/^[a-zA-Z0-9+/=]+$/.test(raw)) {
    try {
      const decoded = Buffer.from(raw, "base64");
      if (decoded.length === 32) return decoded;
    } catch {
      /* fall through to hash derivation */
    }
  }
  return createHash("sha256").update(raw).digest();
}

export function encryptHostedSecret(secret: string, env: NodeJS.ProcessEnv = process.env) {
  const value = trim(secret);
  if (!value) return null;
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", hostedSecretKey(env), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${HOSTED_SECRET_PREFIX}${nonce.toString("base64")}:${Buffer.concat([ciphertext, tag]).toString("base64")}`;
}

export function decryptHostedSecret(encrypted: string | null | undefined, env: NodeJS.ProcessEnv = process.env) {
  const value = trim(encrypted);
  if (!value) return undefined;
  if (!value.startsWith(HOSTED_SECRET_PREFIX)) return undefined;
  try {
    const [nonceText, ciphertextText] = value.slice(HOSTED_SECRET_PREFIX.length).split(":");
    if (!nonceText || !ciphertextText) return undefined;
    const nonce = Buffer.from(nonceText, "base64");
    const encryptedBytes = Buffer.from(ciphertextText, "base64");
    if (nonce.length !== 12 || encryptedBytes.length < 17) return undefined;
    const tag = encryptedBytes.subarray(encryptedBytes.length - 16);
    const ciphertext = encryptedBytes.subarray(0, encryptedBytes.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", hostedSecretKey(env), nonce);
    decipher.setAuthTag(tag);
    return trim(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
  } catch {
    return undefined;
  }
}

function validProvider(provider: string | undefined): provider is LLMProvider {
  return PROVIDERS.has(provider as LLMProvider);
}

function scope(user: Pick<SessionUser, "id" | "workspaceId">) {
  if (!user.workspaceId) throw new Error("Hosted provider settings require a workspace.");
  return and(
    eq(providerSecrets.workspaceId, user.workspaceId),
    eq(providerSecrets.userId, user.id),
    eq(providerSecrets.kind, "llm"),
  );
}

function cleanTaskDefaults(input: unknown): Partial<Record<LLMTask, string>> {
  if (!input || typeof input !== "object") return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .filter(([task, profileId]) => (LLM_TASKS as readonly string[]).includes(task) && typeof profileId === "string" && trim(profileId)),
  ) as Partial<Record<LLMTask, string>>;
}

function rowToView(row: ProviderSecret): HostedProviderProfileView {
  return {
    id: row.profileId,
    label: row.label ?? undefined,
    provider: row.provider as LLMProvider,
    model: row.model ?? "",
    baseUrl: row.baseUrl ?? undefined,
    hasApiKey: row.hasApiKey,
  };
}

function rowToSecret(row: ProviderSecret): HostedProviderProfileSecret {
  return {
    ...rowToView(row),
    apiKey: decryptHostedSecret(row.encryptedApiKey),
  };
}

export async function getHostedProviderSettings(user: Pick<SessionUser, "id" | "workspaceId">): Promise<HostedProviderSettingsView> {
  const rows = await db.select().from(providerSecrets).where(scope(user));
  const validRows = rows.filter((row) => validProvider(row.provider) && row.model);
  const defaultRow = validRows.find((row) => row.isDefault) ?? validRows[0] ?? null;
  return {
    profiles: validRows.map(rowToView),
    defaultProfileId: defaultRow?.profileId ?? null,
    taskDefaults: cleanTaskDefaults(defaultRow?.taskDefaults),
  };
}

export async function getHostedProviderProfile(
  user: Pick<SessionUser, "id" | "workspaceId">,
  profileId: string | undefined | null,
): Promise<HostedProviderProfileSecret | null> {
  const rows = await db.select().from(providerSecrets).where(scope(user));
  const validRows = rows.filter((row) => validProvider(row.provider) && row.model);
  const row = profileId
    ? validRows.find((item) => item.profileId === profileId)
    : validRows.find((item) => item.isDefault) ?? validRows[0];
  return row ? rowToSecret(row) : null;
}

export async function getHostedProviderProfileForProvider(
  user: Pick<SessionUser, "id" | "workspaceId">,
  provider: LLMProvider,
): Promise<HostedProviderProfileSecret | null> {
  const rows = await db.select().from(providerSecrets).where(scope(user));
  const validRows = rows.filter((row) => validProvider(row.provider) && row.model);
  const row = validRows.find((item) => item.provider === provider && item.isDefault)
    ?? validRows.find((item) => item.provider === provider);
  return row ? rowToSecret(row) : null;
}

export async function saveHostedProviderSettings(
  user: Pick<SessionUser, "id" | "workspaceId">,
  settings: HostedProviderSettingsInput,
): Promise<HostedProviderSettingsView> {
  if (!user.workspaceId) throw new Error("Hosted provider settings require a workspace.");
  const profiles = Array.isArray(settings.profiles) && settings.profiles.length
    ? settings.profiles
    : settings.provider && settings.model
      ? [{
          id: "default",
          label: "Default",
          provider: settings.provider,
          model: settings.model,
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
        }]
      : [];
  const defaults = cleanTaskDefaults(settings.taskDefaults);
  const defaultProfileId = trim(settings.defaultProfileId) || profiles[0]?.id;

  for (const profile of profiles) {
    const id = trim(profile.id);
    const model = trim(profile.model);
    if (!id || !model || !validProvider(profile.provider)) continue;
    const [existing] = await db
      .select()
      .from(providerSecrets)
      .where(and(scope(user), eq(providerSecrets.profileId, id)))
      .limit(1);
    const encryptedApiKey = trim(profile.apiKey)
      ? encryptHostedSecret(profile.apiKey!)
      : existing?.encryptedApiKey ?? null;
    const hasApiKey = Boolean(encryptedApiKey);
    const baseUrl = normalizeHostedProviderBaseUrl(profile.baseUrl);
    const values = {
      workspaceId: user.workspaceId,
      userId: user.id,
      kind: "llm",
      profileId: id,
      label: trim(profile.label) ?? null,
      provider: profile.provider,
      model,
      baseUrl: baseUrl ?? null,
      encryptedApiKey,
      hasApiKey,
      isDefault: id === defaultProfileId,
      taskDefaults: id === defaultProfileId ? defaults : {},
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

  return getHostedProviderSettings(user);
}
