/** Resolve Gather connector keys. SERVER ONLY.
 *  The desktop settings UI is the source of truth; env vars remain as
 *  fallbacks for hosted installs and browser dev. */
import { desktopIntegrationKey } from "@/lib/desktopSettings";

type Env = Record<string, string | undefined>;

export function braveSearchKey(env: Env = process.env): string | undefined {
  return (
    desktopIntegrationKey("brave", env) ||
    env.BRAVE_SEARCH_API_KEY ||
    env.Brave_Kings_Press ||
    env.Brave_Pillar_Press // legacy hosted fallback
  );
}

export function xBearerToken(env: Env = process.env): string | undefined {
  return desktopIntegrationKey("x", env) || env.X_BEARER_TOKEN;
}

export function youtubeApiKey(env: Env = process.env): string | undefined {
  return desktopIntegrationKey("youtube", env) || env.YOUTUBE_API_KEY;
}

export function ncbiApiKey(env: Env = process.env): string | undefined {
  return desktopIntegrationKey("ncbi", env) || env.NCBI_API_KEY;
}

/** Secret-free status for the UI ("Connected" badges). */
export function integrationStatus(env: Env = process.env): Record<string, { configured: boolean }> {
  return {
    brave: { configured: Boolean(braveSearchKey(env)) },
    x: { configured: Boolean(xBearerToken(env)) },
    youtube: { configured: Boolean(youtubeApiKey(env)) },
    ncbi: { configured: Boolean(ncbiApiKey(env)) },
  };
}
