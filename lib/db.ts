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
  plans,
  entitlements,
  billingCustomers,
  subscriptions,
  usageEvents,
  usageRollups,
  trialEvents,
  auditEvents,
  backgroundJobs,
  workspaces,
  memberships,
  campaigns,
  references,
  pieces,
  letterRecipients,
  letterWorkflows,
  settings,
  providerSecrets,
} from "@/db/schema";
export type {
  MediaJob,
  NewMediaJob,
  Plan,
  NewPlan,
  Entitlement,
  NewEntitlement,
  SubscriptionStatus,
  Subscription,
  NewSubscription,
  BillingCustomer,
  NewBillingCustomer,
  UsageEvent,
  NewUsageEvent,
  UsageEventStatus,
  UsageEventTask,
  UsageRollup,
  NewUsageRollup,
  TrialEvent,
  NewTrialEvent,
  AuditEvent,
  NewAuditEvent,
  BackgroundJob,
  NewBackgroundJob,
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
  LetterRecipient,
  NewLetterRecipient,
  LetterWorkflow,
  NewLetterWorkflow,
  Setting,
  NewSetting,
  ProviderSecret,
  NewProviderSecret,
} from "@/db/schema";
