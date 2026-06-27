import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Site-wide HTTP Basic Auth gate.
 *
 * While a private preview runs with AUTH_DISABLED (single shared dev user), a
 * public URL would let anyone spend the workspace's AI/media credits. Vercel's
 * built-in Password Protection / Vercel Authentication require a paid plan, so
 * we gate at the app level instead:
 *
 *  - Set SITE_PASSWORD (and optionally SITE_USER or SITE_USERS) in the
 *    environment → every request must present matching Basic credentials.
 *  - Leave SITE_PASSWORD unset (e.g. local dev) → no gate.
 *  - In hosted SaaS mode with real account auth enabled, SITE_PASSWORD is
 *    ignored so Basic Auth cannot shadow the Supabase sign-in screen.
 *
 * Runs on the Edge runtime, so use atob() (Buffer isn't guaranteed there). The
 * browser caches the credentials after the first prompt and resends them on the
 * SPA's same-origin /api fetches automatically.
 */
function configuredUsers(): string[] {
  const raw = process.env.SITE_USERS || process.env.SITE_USER || "";
  const users = raw
    .split(",")
    .map((user) => user.trim())
    .filter(Boolean);
  return users.length ? users : ["pillar"];
}

function truthyEnv(value: string | undefined): boolean {
  return /^(1|true|yes)$/i.test((value ?? "").trim());
}

type SiteBasicAuthEnv = Record<string, string | undefined>;

function hostedWebEnv(env: SiteBasicAuthEnv): boolean {
  return truthyEnv(env.PILLAR_PRESS_HOSTED_WEB) || env.PILLAR_PRESS_RUNTIME === "hosted";
}

function hostedAuthDisabled(env: SiteBasicAuthEnv): boolean {
  return truthyEnv(env.AUTH_DISABLED);
}

export function isSiteBasicAuthEnabled(env: SiteBasicAuthEnv = process.env): boolean {
  const password = env.SITE_PASSWORD?.trim();
  if (!password) return false;

  // Hosted SaaS uses Supabase Auth as the product auth path. Keep Basic Auth
  // available only for explicit shared-workspace private previews.
  if (hostedWebEnv(env) && !hostedAuthDisabled(env)) return false;

  return true;
}

export function isSiteBasicAuthAuthorized(
  authorizationHeader: string | null,
  password = process.env.SITE_PASSWORD,
  users = configuredUsers(),
): boolean {
  if (!password) return true;
  const header = authorizationHeader || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    let decoded = "";
    try {
      decoded = atob(encoded);
    } catch {
      decoded = "";
    }
    const sep = decoded.indexOf(":");
    const user = sep >= 0 ? decoded.slice(0, sep) : "";
    const pass = sep >= 0 ? decoded.slice(sep + 1) : "";
    return users.includes(user) && pass === password;
  }
  return false;
}

export function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!isSiteBasicAuthEnabled()) return NextResponse.next(); // gate disabled when unconfigured

  if (isSiteBasicAuthAuthorized(req.headers.get("authorization"), password)) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Pillar\'s Press", charset="UTF-8"' },
  });
}

// Protect everything except Next's build assets (so the gate covers the static
// front-end in public/ and all /api routes). Auth assets are tiny and cached.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
