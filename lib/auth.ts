/**
 * Auth — Supabase-backed session resolution + role authorization.
 *
 * getCurrentUser() reads the Supabase session server-side from the request's
 * Authorization bearer token (or a `sb-access-token` cookie), validates it
 * against Supabase Auth, and resolves a {@link SessionUser} from the user's
 * membership row (which carries the active workspace + role).
 *
 * SERVER ONLY. Supabase service-role / JWT secrets live in env and are never
 * exposed to the client; the browser only calls our own /api/* routes.
 *
 * Dev convenience: when NODE_ENV !== 'production', an `x-debug-user` header (and
 * optional `x-debug-workspace` / `x-debug-role`) short-circuits the Supabase
 * round-trip so the app is runnable without the Supabase stack up.
 */
import { headers, cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db, memberships } from "@/lib/db";
import { supabaseFromToken } from "@/lib/supabase";

export type Role = (typeof import("@/db/schema").membershipRole)[number];

export interface SessionUser {
  id: string;
  workspaceId?: string;
  role?: Role;
}

/* ------------------------------------------------------------------ *
 * Tagged errors — `status` is read by lib/errors.ts#toErrorResponse.
 * ------------------------------------------------------------------ */
function unauthorized(msg = "Unauthorized"): Error {
  const e = new Error(msg);
  (e as any).status = 401;
  (e as any).code = "unauthorized";
  return e;
}

function forbidden(msg = "Forbidden"): Error {
  const e = new Error(msg);
  (e as any).status = 403;
  (e as any).code = "forbidden";
  return e;
}

/** Pull the Supabase access token from the Authorization header or cookie. */
async function readAccessToken(): Promise<string | null> {
  const h = await headers();
  const authz = h.get("authorization") ?? h.get("Authorization");
  if (authz && /^bearer\s+/i.test(authz)) {
    return authz.replace(/^bearer\s+/i, "").trim() || null;
  }
  // Supabase JS stores the session in `sb-access-token` (or a project-prefixed
  // variant). Accept the canonical cookie name.
  const c = await cookies();
  const cookieToken =
    c.get("sb-access-token")?.value ?? c.get("supabase-access-token")?.value;
  return cookieToken ?? null;
}

/**
 * Resolve the caller's SessionUser from the membership row. Picks the most
 * recently created membership as the active workspace (UI may switch later via
 * an explicit workspace/campaign id — data scoping is always explicit).
 * Returns just the id (no workspace) if no membership exists yet, so callers can
 * bootstrap one via {@link getOrCreateWorkspace}.
 */
async function resolveMembership(userId: string): Promise<SessionUser> {
  const rows = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, userId));

  if (rows.length === 0) return { id: userId };

  // Deterministic pick: newest membership wins.
  const active = rows.reduce((a, b) =>
    a.createdAt > b.createdAt ? a : b,
  );
  return { id: userId, workspaceId: active.workspaceId, role: active.role };
}

/**
 * Read and validate the current session. Returns null when there is no valid
 * session (the route's requireUser() turns that into a 401).
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  // Dev-only fallback: bypass Supabase entirely with x-debug-* headers.
  if (process.env.NODE_ENV !== "production") {
    const h = await headers();
    const debugId = h.get("x-debug-user");
    if (debugId) {
      const debugWorkspace = h.get("x-debug-workspace") ?? undefined;
      const debugRole = h.get("x-debug-role") as Role | null;
      if (debugWorkspace) {
        return {
          id: debugId,
          workspaceId: debugWorkspace,
          role: debugRole ?? "author",
        };
      }
      // No explicit workspace header → resolve from membership like a real user.
      const resolved = await resolveMembership(debugId);
      if (debugRole) resolved.role = debugRole;
      return resolved;
    }
  }

  const token = await readAccessToken();
  if (!token) return null;

  let userId: string;
  try {
    const supabase = supabaseFromToken(token);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    userId = data.user.id;
  } catch {
    // Misconfiguration / network — treat as no session rather than leaking 500s
    // from a read of the session.
    return null;
  }

  return resolveMembership(userId);
}

/** Require a valid session or throw a 401-tagged error. */
export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw unauthorized();
  return u;
}

/**
 * Require a valid session AND a specific role. Throws 401 if unauthenticated,
 * 403 if the role does not match. Returns the SessionUser otherwise.
 */
export async function requireRole(role: Role): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== role) throw forbidden(`Requires ${role} role.`);
  return u;
}

/**
 * Assert the caller is an author (used by reference write routes — assistants
 * may not edit References). Throws 403 for non-authors.
 */
export async function assertAuthor(): Promise<SessionUser> {
  return requireRole("author");
}

/**
 * Bootstrap helper: ensure the user has a workspace. If they already have a
 * membership, returns its workspaceId. Otherwise creates a workspace, an author
 * membership, and seeds the 11 default campaigns (+ their references) by calling
 * the seed module.
 *
 * The seed module is imported LAZILY to avoid an import cycle
 * (auth -> seed -> db, while routes import auth).
 */
export async function getOrCreateWorkspace(userId: string): Promise<string> {
  const existing = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, userId));
  if (existing.length > 0) {
    const active = existing.reduce((a, b) =>
      a.createdAt > b.createdAt ? a : b,
    );
    return active.workspaceId;
  }

  const { workspaces } = await import("@/lib/db");
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: "My Workspace" })
    .returning();

  await db.insert(memberships).values({
    workspaceId: workspace.id,
    userId,
    role: "author",
  });

  // Lazy import breaks the auth <-> seed <-> db cycle.
  const { seedWorkspace } = await import("@/lib/seed");
  await seedWorkspace(db, workspace.id);

  return workspace.id;
}

/** Guard: is the given user already a member of the given workspace? */
export async function isMember(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)),
    )
    .limit(1);
  return rows.length > 0;
}
