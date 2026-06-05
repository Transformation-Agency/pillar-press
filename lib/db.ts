/** Database seam — point this at Pillar Press's existing Drizzle client.
 *  Only the `db` instance and the `mediaJobs` table are used by the routes. */
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
