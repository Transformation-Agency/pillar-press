/**
 * Workspace bootstrap for King's Press.
 *
 * The desktop app intentionally starts lean: no default campaigns are inserted.
 * User-created campaigns receive a blank references skeleton from
 * `EMPTY_REFERENCES`.
 */
import type { db as Db } from "@/lib/db";
export {
  EMPTY_REFERENCES,
  CAMPAIGN_NAMES,
  SEED_REFERENCES,
  slug,
  type SeedReferences,
} from "@/lib/seed-data";

/**
 * Keep compatibility with callers that expect a seeding hook. Returns an empty
 * list because normal users should create only the campaigns they need.
 */
export async function seedWorkspace(_database: typeof Db, _workspaceId: string) {
  return [];
}
