/** Hosted Postgres Drizzle client.
 *
 * The desktop product uses `lib/local/database.ts` and embedded SQLite. This
 * module remains for legacy/web compatibility routes that still run against
 * hosted Postgres.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
export {
  mediaJobs,
  workspaces,
  memberships,
  campaigns,
  references,
  pieces,
  settings,
} from "@/db/schema";
export type {
  MediaJob,
  NewMediaJob,
  Workspace,
  NewWorkspace,
  Membership,
  NewMembership,
  Campaign,
  NewCampaign,
  Reference,
  NewReference,
  Piece,
  NewPiece,
  Setting,
  NewSetting,
} from "@/db/schema";
