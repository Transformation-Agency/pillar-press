/**
 * Hosted compatibility Supabase client helpers.
 *
 * The King’s Press desktop runtime does not call this module. Local-first auth,
 * database, and storage are handled by embedded SQLite and app-data files.
 *
 * SERVER ONLY. These read service-role / JWT secrets from the environment and
 * must never be imported into client components. The browser only ever talks to
 * our own /api/* routes; it never holds these keys.
 *
 * Two distinct clients:
 *  - `supabaseAdmin()` uses the service-role key and bypasses RLS. Use it for
 *    trusted server work (resolving a user from a bearer token, bootstrap).
 *  - `supabaseFromToken(jwt)` is scoped to a specific user's access token and is
 *    the path we use to validate the caller's session.
 *
 * Everything is lazily constructed so importing this module never throws during
 * a local desktop build where hosted Supabase env vars are absent.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Public project URL. Safe to expose; it is just the API endpoint. */
function supabaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    ""
  );
}

/** Service-role key — SECRET. Full access, bypasses RLS. Server only. */
function serviceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

let _admin: SupabaseClient | null = null;

/**
 * Admin client (service role). Memoized. Throws a tagged 500 error only when
 * actually invoked without configuration — importing the module is always safe.
 */
export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) {
    const e = new Error("Supabase is not configured.");
    (e as any).status = 500;
    (e as any).code = "config";
    throw e;
  }
  _admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}

/**
 * A client bound to a specific user access token. Used to validate the caller's
 * session and read their identity (`auth.getUser`). Not memoized — token varies
 * per request.
 */
export function supabaseFromToken(accessToken: string): SupabaseClient {
  const url = supabaseUrl();
  // The anon key is not required for getUser() when an explicit Authorization
  // header is supplied; fall back to the service-role key as the apikey so the
  // request is accepted by the gateway. The bearer token still scopes identity.
  const apiKey = serviceRoleKey() || accessToken;
  if (!url) {
    const e = new Error("Supabase is not configured.");
    (e as any).status = 500;
    (e as any).code = "config";
    throw e;
  }
  return createClient(url, apiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && serviceRoleKey());
}
