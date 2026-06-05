/**
 * Auth seam — replace with Pillar Press's real session lookup
 * (next-auth, Clerk, Supabase, etc.). Every Hedra/media route calls this and
 * 401s when there is no user, so one user can never read/write another's jobs.
 */
import { headers } from "next/headers";

export interface SessionUser {
  id: string;
  workspaceId?: string;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  // TODO: wire to your actual auth. Example placeholder:
  //   const session = await auth();
  //   return session?.user ? { id: session.user.id, workspaceId: session.user.workspaceId } : null;
  const h = await headers();
  const id = h.get("x-debug-user"); // dev only — remove in production
  return id ? { id } : null;
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) {
    const e = new Error("Unauthorized");
    (e as any).status = 401;
    throw e;
  }
  return u;
}
