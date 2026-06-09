import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Site-wide HTTP Basic Auth gate.
 *
 * While the app runs with AUTH_DISABLED (single shared dev user), a public URL
 * would let anyone spend the workspace's AI/media credits. Vercel's built-in
 * Password Protection / Vercel Authentication require a paid plan, so we gate at
 * the app level instead:
 *
 *  - Set SITE_PASSWORD (and optionally SITE_USER, default "king") in the
 *    environment → every request must present matching Basic credentials.
 *  - Leave SITE_PASSWORD unset (e.g. local dev) → no gate.
 *
 * Runs on the Edge runtime, so use atob() (Buffer isn't guaranteed there). The
 * browser caches the credentials after the first prompt and resends them on the
 * SPA's same-origin /api fetches automatically.
 */
export function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next(); // gate disabled when unconfigured

  const expectedUser = process.env.SITE_USER || "king";
  const header = req.headers.get("authorization") || "";
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
    if (user === expectedUser && pass === password) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="King\'s Press", charset="UTF-8"' },
  });
}

// Protect everything except Next's build assets (so the gate covers the static
// front-end in public/ and all /api routes). Auth assets are tiny and cached.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
