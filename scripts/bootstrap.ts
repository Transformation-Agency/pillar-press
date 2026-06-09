/**
 * Dev bootstrap: ensure a workspace exists for a user id. Idempotent. Used for
 * local end-to-end testing with the x-debug-user auth seam. Campaigns are no
 * longer seeded by default; create only the campaigns a test actually needs.
 *
 *   DATABASE_URL=... DEV_USER=dev-user npx tsx scripts/bootstrap.ts
 */
import { eq } from "drizzle-orm";
import { db, workspaces, memberships, campaigns } from "@/lib/db";
import { seedWorkspace } from "@/lib/seed";

const userId = process.env.DEV_USER ?? "dev-user";

const existing = await db.select().from(memberships).where(eq(memberships.userId, userId));

let workspaceId: string;
if (existing.length > 0) {
  workspaceId = existing.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)).workspaceId;
} else {
  const [ws] = await db.insert(workspaces).values({ name: "My Workspace" }).returning();
  workspaceId = ws.id;
  await db.insert(memberships).values({ workspaceId, userId, role: "author" });
  await seedWorkspace(db, workspaceId);
}

const camps = await db.select().from(campaigns).where(eq(campaigns.workspaceId, workspaceId));
console.log(
  JSON.stringify(
    {
      userId,
      workspaceId,
      campaignCount: camps.length,
      campaigns: camps.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
    },
    null,
    2,
  ),
);
process.exit(0);
