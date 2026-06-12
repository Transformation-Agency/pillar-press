# King's Press SaaS Product Contract

This is the Stage 0 contract for converting the hosted King's Press web app into
a production subscription SaaS. It is intentionally additive: it preserves the
current desktop/local-first app and gives the hosted web branch a clean
foundation for auth, billing, entitlements, usage metering, and quota
enforcement.

## Migration Strategy

Do this as a staged migration, not a rewrite.

1. Stage 0: product contract, schema, and migration.
2. Stage 1: real hosted auth and tenant isolation.
3. Stage 2: Stripe billing foundation. **Implemented:** trial status,
   Checkout, Customer Portal, signed webhook sync routes, and sanitized Stripe
   webhook audit events are in place.
4. Stage 3: entitlement checks, usage reservations, and quota enforcement.
   **Started:** hosted-only usage reservation helpers now enforce active/trial
   subscription status, expired trial dates, usage limits, storage quota,
   campaign-count limits, plus managed-provider, export, and Drive feature
   access, while desktop/local-first bypasses them.
5. Stage 4: trial onboarding and upgrade UI. **Started:** hosted users now
   have a Billing panel showing trial/subscription status, period usage, paid
   plan upgrades, the Stripe customer portal, normalized trial lifecycle copy
   from `/api/billing/status`, and an automatic upgrade prompt when an API route
   returns `quota_exceeded`, `subscription_required`, `subscription_inactive`,
   or `trial_expired`.
6. Stage 5: workers/jobs for long-running Gather, Weave, media, and batch work.
   **Started:** a hosted `background_jobs` table plus typed enqueue/claim/
   complete/fail/cancel helpers and a secret-protected worker endpoint now
   provide the database-backed queue foundation for moving long operations out
   of synchronous API requests. The first registered worker kind is
   `gather_run`.
7. Stage 6: production ops, admin, support, observability, and launch gates.
   **Started:** sensitive hosted mutations now record sanitized audit events for
   Stripe webhooks, billing Checkout/Portal sessions, and hosted LLM/media BYOK
   provider setting updates.

No stage should weaken the desktop path. Desktop/local-first stays SQLite and
does not read or write the SaaS billing tables.

## MVP Plans

### Free Trial

Recommended default: 7 days.

Purpose:
- Let a user experience the hosted writing desk without a manual sales flow.
- Keep managed provider cost tightly bounded.
- Encourage upgrade before large workflows.

Default entitlement:
- `max_campaigns`: 2
- `monthly_llm_credits`: 250
- `monthly_media_generations`: 5
- `monthly_gather_runs`: 10
- `storage_quota_gb`: 1
- `allowed_providers`: `["managed", "byok"]`
- `can_use_managed_keys`: true
- `max_concurrent_jobs`: 1
- `export_enabled`: true
- `drive_enabled`: false

### Starter

Personal workspace for a single author.

Default entitlement:
- `max_campaigns`: 10
- `monthly_llm_credits`: 2000
- `monthly_media_generations`: 40
- `monthly_gather_runs`: 100
- `storage_quota_gb`: 5
- `allowed_providers`: `["managed", "byok"]`
- `can_use_managed_keys`: true
- `max_concurrent_jobs`: 2
- `export_enabled`: true
- `drive_enabled`: true

### Pro

Higher limits for active publishing workflows.

Default entitlement:
- `max_campaigns`: 50
- `monthly_llm_credits`: 10000
- `monthly_media_generations`: 250
- `monthly_gather_runs`: 500
- `storage_quota_gb`: 25
- `allowed_providers`: `["managed", "byok"]`
- `can_use_managed_keys`: true
- `max_concurrent_jobs`: 5
- `export_enabled`: true
- `drive_enabled`: true

### Team

Phase 2 shared workspace plan. The schema includes it now so Stripe and
entitlement code do not need to be redesigned later, but Team UI and
collaboration workflows should ship after the personal plans are stable.

Default entitlement:
- `max_campaigns`: 250
- `monthly_llm_credits`: 50000
- `monthly_media_generations`: 1000
- `monthly_gather_runs`: 2500
- `storage_quota_gb`: 100
- `allowed_providers`: `["managed", "byok"]`
- `can_use_managed_keys`: true
- `max_concurrent_jobs`: 15
- `export_enabled`: true
- `drive_enabled`: true

## Table Contract

Stage 0 adds these hosted Postgres tables in
`db/migrations/0006_saas_foundation.sql` and `db/schema.ts`.

### `plans`

Global catalog of purchasable plans and the internal trial plan.

Important fields:
- `id`: stable key, e.g. `trial`, `starter`, `pro`, `team`
- `stripe_price_id`: Stripe Price id, nullable until Stripe is configured
- `monthly_price_cents`
- `trial_days`
- `active`
- `meta`

### `entitlements`

One row per plan. This is the source of truth for feature/quota checks.

Important fields:
- `max_campaigns`
- `monthly_llm_credits`
- `monthly_media_generations`
- `monthly_gather_runs`
- `storage_quota_gb`
- `allowed_providers`
- `can_use_managed_keys`
- `max_concurrent_jobs`
- `export_enabled`
- `drive_enabled`

### `billing_customers`

Workspace-to-Stripe-customer mapping.

Important fields:
- `workspace_id`
- `stripe_customer_id`
- `billing_email`

Rule:
- One billing customer per workspace.

### `subscriptions`

Workspace subscription state synchronized from Stripe webhooks.

Important fields:
- `workspace_id`
- `plan_id`
- `stripe_customer_id`
- `stripe_subscription_id`
- `stripe_price_id`
- `status`
- `trial_start`
- `trial_end`
- `current_period_start`
- `current_period_end`
- `cancel_at_period_end`
- `canceled_at`

Valid statuses:
- `trialing`
- `active`
- `past_due`
- `canceled`
- `unpaid`
- `incomplete`
- `incomplete_expired`
- `paused`

Rule:
- Stripe webhooks become the source of truth. Client redirects from Checkout are
  never treated as proof of payment.

### `usage_events`

Append-oriented ledger for expensive operations and quota enforcement.

Important fields:
- `workspace_id`
- `user_id`
- `campaign_id`
- `piece_id`
- `idempotency_key`
- `task`
- `feature`
- `provider`
- `model`
- `status`
- `estimated_credits`
- `actual_credits`
- `input_tokens`
- `output_tokens`
- `estimated_cost_usd`
- `actual_cost_usd`
- `provider_request_id`
- `error_code`
- `error_message`

Valid statuses:
- `reserved`
- `succeeded`
- `failed`
- `canceled`

Valid initial tasks:
- `review`
- `revision`
- `outputs`
- `weave`
- `gather`
- `file_extract`
- `media_generation`
- `chat`
- `utility`

Rule:
- Every expensive operation must reserve usage before calling providers and then
  complete the usage event with actual values.

### `usage_rollups`

Monthly/period aggregate for fast quota checks and billing/ops views.

Important fields:
- `workspace_id`
- `period_start`
- `period_end`
- `llm_credits_used`
- `media_generations_used`
- `gather_runs_used`
- `storage_bytes_used`
- `cost_usd`

Rule:
- The ledger is authoritative; rollups are cached summaries that can be rebuilt.

### `trial_events`

Lifecycle log for trial start, extension, ending reminders, conversion, and
expiration.

Important fields:
- `workspace_id`
- `user_id`
- `event`
- `plan_id`
- `trial_start`
- `trial_end`
- `metadata`

Implemented events:
- `started`: created when the hosted workspace first receives a trial
  subscription.
- `ending_reminder`: created once when billing status first observes that a
  trial is inside the ending-soon upgrade window. Metadata is limited to the
  source, local subscription id, and days remaining.
- `converted`: created when Stripe syncs an active/trialing paid subscription
  from Checkout completion or subscription webhooks. Metadata is limited to
  Stripe/local ids needed for support reconciliation and does not include emails,
  raw Stripe payloads, or secrets.
- `expired`: created once when billing status or a hosted gated operation first
  observes that the workspace trial has ended.

### `audit_events`

Security/support log for important hosted mutations.

Important fields:
- `workspace_id`
- `actor_type`
- `actor_id`
- `action`
- `target_type`
- `target_id`
- `ip_hash`
- `user_agent`
- `metadata`

Initial actor types:
- `user`
- `system`
- `stripe`
- `admin`

Initial audited actions:
- Stripe webhook handling.
- Billing Checkout and Customer Portal session creation.
- Hosted LLM/media provider profile updates, with secret-free metadata only.

### `background_jobs`

Hosted queue foundation for long-running Gather, Weave, media, export, and
maintenance workflows.

Important fields:
- `workspace_id`, `user_id`, `campaign_id`, `piece_id`
- `kind`
- `status`
- `priority`
- `run_after`
- `locked_by`, `locked_at`
- `attempts`, `max_attempts`
- `idempotency_key`
- `payload`, `result`
- `error_code`, `error_message`

Valid statuses:
- `queued`
- `processing`
- `succeeded`
- `failed`
- `canceled`

Initial kinds:
- `gather_run`
- `weave`
- `media_generation`
- `bulk_export`
- `maintenance`

Rule:
- Background job payloads/results are workflow metadata, not secret storage.
  The shared helper redacts obvious secret-like keys before persistence.

## Entitlement Enforcement Contract

All expensive routes will eventually follow this pattern:

```ts
const user = await requireUser();
const workspace = await resolveWorkspace(user);
await requireEntitlement(workspace.id, "review");
const reservation = await reserveUsage({
  workspaceId: workspace.id,
  userId: user.id,
  task: "review",
  feature: "piece.review",
  estimatedCredits: 7,
  idempotencyKey,
});

try {
  const result = await runExpensiveOperation();
  await completeUsage(reservation.id, { status: "succeeded", actualCredits });
  return result;
} catch (err) {
  await completeUsage(reservation.id, { status: "failed", error: err });
  throw err;
}
```

Routes that must be wrapped in Stage 3:
- `POST /api/pieces/[id]/review`
- `POST /api/pieces/[id]/revision`
- `POST /api/pieces/[id]/outputs`
- `POST /api/pieces/[id]/outputs/[platform]/condense`
- `POST /api/weave`
- `POST /api/gather/run`
- `POST /api/extract`
- `POST /api/hedra/prompt`
- `POST /api/hedra/voice-script`
- `POST /api/hedra/generate`
- `POST /api/desk/chat` when managed keys are used

## BYOK And Managed Keys

King's Press should support both:

- BYOK: user/workspace stores encrypted provider keys server-side.
- Managed: King's Press uses platform-owned provider keys with strict quotas.

Rules:
- Browser never receives raw provider keys.
- Desktop keys remain in the encrypted desktop settings path.
- Hosted BYOK keys must be encrypted at rest before Stage 3 quota enforcement
  opens broad managed-key usage. **Started:** hosted web now writes LLM provider
  profiles to `provider_secrets` with encrypted API keys, returns only
  secret-free metadata, and lets the model setup/test/list flow reuse a saved
  profile without sending the stored key back to the browser. Desk chat,
  `/api/llm/util`, onboarding setup extraction, review, revision, outputs,
  output condense, title generation, Weave, manual Gather summaries,
  references AI edit, style feedback, and Studio image/voice prompt helpers now
  resolve the user's saved default/task profile server-side, mark usage as
  BYOK, and bypass only the managed-provider entitlement gate while still
  enforcing subscription and usage quotas.
- Hosted media BYOK uses the same encrypted secret-store contract. **Started:**
  hosted web now writes media provider profiles to `provider_secrets` with
  `kind = "media"` for Hedra, ElevenLabs, OpenAI media, xAI media, and custom
  image endpoints through `GET/PUT /api/media/provider-settings`; Studio media
  generation, provider status, Hedra model/status/asset calls, OpenAI-compatible
  media calls, and ElevenLabs TTS now resolve those hosted BYOK profiles
  server-side before falling back to managed keys. First-run setup, full-screen
  model setup, and Studio provider settings now write hosted media keys through
  the encrypted media provider settings route instead of requiring env vars.
- Trial workspaces can use managed keys only within tight usage caps.

## Stage 1 Success Gate

Stage 1 is complete only when:
- Hosted production uses Supabase Auth. **Implemented:** hosted/web/Postgres
  runtime now requires account auth by default when `AUTH_DISABLED` is omitted;
  `.env.hosted.example` and `docs/WEB_DEPLOY.md` still set
  `AUTH_DISABLED=false` explicitly for operator clarity.
- Basic Auth is no longer the product auth path. **Implemented:** Basic Auth is
  ignored in hosted SaaS mode when account auth is active, and remains available
  only as a temporary private-preview gate while `AUTH_DISABLED=true`.
- A new user can sign up and get a workspace. **Implemented:** the static web app
  has a hosted sign-in/sign-up gate, and `/api/auth/session` bootstraps a
  workspace plus the initial trial subscription row for authenticated Supabase
  users with no membership.
- Users can recover account access. **Implemented:** the hosted auth gate can
  request Supabase password recovery emails, detect recovery tokens in the
  browser URL fragment, and submit a new password through the authenticated
  Supabase Auth user update flow.
- `requireUser()` resolves a Supabase user and workspace membership.
  **Implemented:** browser API calls attach the Supabase bearer token; the server
  auth layer validates it, resolves membership, and bootstraps a workspace before
  normal API routes run if an authenticated user has no membership yet.
- Browser state is scoped to the active hosted account. **Implemented:** the
  REST-backed static Store clears its in-memory campaigns, pieces, media,
  billing, Gather, Weave, and desk cache before rehydrating after sign-in and
  immediately after hosted sign-out, preventing account data from lingering in a
  reused browser tab.
- Cross-workspace object access is denied and tested. **Started:** shared
  campaign/workspace scope helper plus regression tests now guard the hosted
  contract; Gather sources/items/runs and media jobs/prompt/status/export
  routes now prove campaign or media workspace scope before reads/writes.
- Hosted Gather schedules are tenant-scoped. **Started:** schedules now persist
  to hosted Postgres outside local-first mode, and `run-due` executes only the
  authenticated caller's enabled schedules inside their workspace.
- The app can still run desktop/local-first without touching hosted auth.

## Stage 2 Success Gate

Stage 2 is complete only when:
- Stripe Checkout creates or updates a workspace subscription. **Implemented:**
  `POST /api/billing/checkout` creates subscription-mode Checkout Sessions and
  stores workspace/user/plan metadata for reconciliation. It now refuses to
  create duplicate Checkout sessions for an already active paid subscription;
  existing paid subscribers must use the Customer Portal until an explicit
  in-app plan-change flow is added.
- Stripe Customer Portal opens for the workspace billing customer.
  **Implemented:** `POST /api/billing/portal` returns a hosted portal URL.
  Checkout and Portal creation default the Stripe billing customer email from
  the authenticated hosted account, and existing customer rows created before
  email capture are repaired when a verified account email is available.
- Webhooks verify signatures and sync DB state. **Implemented:**
  `POST /api/billing/webhook` verifies the raw Stripe payload and syncs
  subscription created/updated/deleted plus Checkout completion events.
- Trial-to-paid conversion is trackable. **Implemented:** Checkout completion
  and paid subscription created/updated webhooks record a secret-free
  `trial_events.converted` row, idempotent per workspace/plan for webhook
  retries and out-of-order Stripe delivery.
- Subscription state survives browser redirects and refreshes. **Implemented:**
  subscription rows are stored in Postgres; `GET /api/billing/status` returns
  the current workspace subscription and public plan catalog. Current
  subscription selection now intentionally prefers active/trialing paid
  Stripe-backed rows over bootstrap trial rows and keeps paid billing problems
  such as `past_due` visible instead of silently falling back to trial access.
- Failed payment/past-due/canceled states are represented in the DB.
  **Implemented:** Stripe statuses map into the subscription status enum,
  including `past_due`, `canceled`, `unpaid`, `incomplete`, and `paused`.

## Stage 3 Success Gate

Stage 3 is complete only when:
- Every expensive route reserves and records usage. **Started:** desk chat,
  utility LLM calls, review, revision, outputs, output condense, title
  generation, Weave, model-backed file extraction, manual and scheduled Gather
  runs, and Studio media generation now reserve usage before provider work and
  mark usage succeeded/failed afterward.
- Quotas block over-limit work before provider calls. **Started:** the shared
  reservation helper checks the current subscription period against plan
  entitlements before inserting the reservation; hosted campaign creation now
  checks `max_campaigns` before inserting a campaign, and hosted media
  generation checks `max_concurrent_jobs` against active queued/processing
  media jobs before calling any media provider.
- Feature gates block plan-restricted integrations. **Started:** hosted book
  export requires `export_enabled`, browser-only output downloads open the
  billing prompt when exports are disabled, and hosted Google Drive OAuth and
  upload routes require `drive_enabled` before linking or exporting to Drive;
  desktop/local-first continues to use local exports.
- Managed provider access honors plan entitlements. **Started:** hosted usage
  reservations require `can_use_managed_keys` and `"managed"` in
  `allowed_providers` before server-managed AI/media/research work begins;
  hosted Hedra credit status no longer calls the platform Hedra account or
  returns platform credit balances to ordinary users, and hosted live
  ElevenLabs/Hedra catalog calls require managed-provider access before touching
  platform provider APIs.
- BYOK provider access honors plan entitlements. **Started:** user-saved hosted
  provider profiles are marked as `providerSource: "byok"` on usage
  reservations across the core editorial, Gather, Weave, utility, onboarding,
  and Studio prompt paths; they require `"byok"` in `allowed_providers` but do
  not require managed-provider access. BYOK Hedra credit checks require BYOK
  provider access before touching a user-supplied Hedra key, and BYOK
  ElevenLabs voice checks require BYOK access before touching user-supplied
  ElevenLabs keys.
- Storage quota gates hosted persisted media. **Started:** Supabase public
  storage uploads that receive an authenticated hosted user reserve bytes
  against `storage_quota_gb`, release the reservation on failed upload, and
  report storage usage in the Billing panel; desktop/local-first file writes
  bypass hosted storage billing.
- Hosted media BYOK generation works end to end. **Not complete:** see
  `docs/MEDIA_BYOK_AUDIT.md` for the current credential-flow audit and required
  implementation order. Server-side generation/status consumption is
  implemented; hosted setup/UI media profile management can add, replace, and
  remove encrypted media profiles, test saved profiles without exposing keys,
  and read provider help/default metadata from the secret-free provider catalog;
  the remaining proof point is live provider smoke coverage against staging
  BYOK keys.
- Usage rollups reflect the ledger. **Started:** `GET /api/billing/status`
  rebuilds the current billing period's `usage_rollups` row from
  `usage_events` for LLM, media, Gather, provider cost, and existing storage
  bytes before returning the hosted Billing panel summary.
- Provider failure records failed usage without double-charging. **Started:**
  the first gated routes mark reserved usage as failed when downstream work
  throws.
- Usage event metadata remains attributable after success. **Implemented:** the
  usage completion helper merges successful provider response metadata into the
  original reservation metadata instead of replacing it, so fields like
  `providerSource`, `profileId`, and BYOK/managed provenance survive for billing
  reports and support audits.
- Idempotency keys prevent duplicate reservations. **Started:** reservations
  use the workspace/idempotency unique key and reuse existing reservations when
  a request key is repeated; usage finalizers only transition `reserved` rows to
  `succeeded` or `failed`, so replayed idempotency keys cannot mutate already
  completed usage events.

## Development Order

1. Apply `0006_saas_foundation.sql` and `0007_gather_schedules.sql` to hosted Postgres.
2. Stage 1: implement hosted Supabase Auth and workspace creation.
3. Stage 1: add tenant isolation tests for campaigns, pieces, references,
   Gather, media jobs, settings, and billing tables.
4. Stage 2: add Stripe Checkout, Portal, and webhook routes.
5. Stage 2: map Stripe Price ids into `plans.stripe_price_id`.
6. Stage 3: implement `lib/saas/entitlements.ts` and `lib/saas/usage.ts`.
7. Stage 3: wrap expensive routes.
8. Stage 4: update onboarding and account/billing UI. **Started:** the hosted
   topbar Billing panel calls `/api/billing/status`, `/api/billing/checkout`,
   and `/api/billing/portal`; `/api/billing/status` returns a normalized
   `lifecycle` object for trial ending/expired/upgrade actions; hosted API
   billing-blocked responses open the same panel with context; Checkout is
   server-guarded against duplicate paid subscriptions, and both server and UI
   direct existing paid subscribers to Customer Portal for plan changes.
9. Stage 5: introduce a worker/job runner for long operations. **Started:**
   `db/migrations/0009_background_jobs.sql`, `db/schema.ts`,
   `lib/jobs/background.ts`, `lib/jobs/runner.ts`, and `POST /api/jobs/run`
   define the hosted queue and a secret-protected worker entry point. Hosted
   `POST /api/gather/run` now enqueues manual Gather jobs, returns `202`, and
   exposes scoped polling through `GET /api/gather/run/:jobId`; local-first
   Gather remains synchronous.
10. Stage 6: add admin/support tooling and production observability.
