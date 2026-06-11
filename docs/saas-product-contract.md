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
   plan upgrades, the Stripe customer portal, and an automatic upgrade prompt
   when an API route returns `quota_exceeded`, `subscription_required`,
   `subscription_inactive`, or `trial_expired`.
6. Stage 5: workers/jobs for long-running Gather, Weave, media, and batch work.
7. Stage 6: production ops, admin, support, observability, and launch gates.

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
  profile without sending the stored key back to the browser.
- Trial workspaces can use managed keys only within tight usage caps.

## Stage 1 Success Gate

Stage 1 is complete only when:
- Hosted production uses `AUTH_DISABLED=false`. **Started:** `.env.hosted.example`
  and `docs/WEB_DEPLOY.md` now default hosted SaaS to Supabase Auth.
- Basic Auth is no longer the product auth path. **Started:** Basic Auth remains
  documented only as a temporary private-preview gate while `AUTH_DISABLED=true`.
- A new user can sign up and get a workspace. **Started:** the static web app now
  has a hosted sign-in/sign-up gate, and `/api/auth/session` bootstraps a
  workspace for authenticated Supabase users with no membership.
- `requireUser()` resolves a Supabase user and workspace membership. **Started:**
  browser API calls attach the Supabase bearer token; the existing server auth
  layer validates it and resolves membership.
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
  stores workspace/user/plan metadata for reconciliation.
- Stripe Customer Portal opens for the workspace billing customer.
  **Implemented:** `POST /api/billing/portal` returns a hosted portal URL.
- Webhooks verify signatures and sync DB state. **Implemented:**
  `POST /api/billing/webhook` verifies the raw Stripe payload and syncs
  subscription created/updated/deleted plus Checkout completion events.
- Subscription state survives browser redirects and refreshes. **Implemented:**
  subscription rows are stored in Postgres; `GET /api/billing/status` returns
  the current workspace subscription and public plan catalog.
- Failed payment/past-due/canceled states are represented in the DB.
  **Implemented:** Stripe statuses map into the subscription status enum,
  including `past_due`, `canceled`, `unpaid`, `incomplete`, and `paused`.

## Stage 3 Success Gate

Stage 3 is complete only when:
- Every expensive route reserves and records usage. **Started:** desk chat,
  utility LLM calls, review, revision, outputs, output condense, title
  generation, Weave, model-backed file extraction, manual Gather runs, and
  Studio media generation now reserve usage before provider work and mark usage
  succeeded/failed afterward.
- Quotas block over-limit work before provider calls. **Started:** the shared
  reservation helper checks the current subscription period against plan
  entitlements before inserting the reservation; hosted campaign creation now
  checks `max_campaigns` before inserting a campaign.
- Feature gates block plan-restricted integrations. **Started:** hosted book
  export requires `export_enabled`, browser-only output downloads open the
  billing prompt when exports are disabled, and hosted Google Drive OAuth and
  upload routes require `drive_enabled` before linking or exporting to Drive;
  desktop/local-first continues to use local exports.
- Managed provider access honors plan entitlements. **Started:** hosted usage
  reservations require `can_use_managed_keys` and `"managed"` in
  `allowed_providers` before server-managed AI/media/research work begins.
- Storage quota gates hosted persisted media. **Started:** Supabase public
  storage uploads that receive an authenticated hosted user reserve bytes
  against `storage_quota_gb`, release the reservation on failed upload, and
  report storage usage in the Billing panel; desktop/local-first file writes
  bypass hosted storage billing.
- Usage rollups reflect the ledger.
- Provider failure records failed usage without double-charging. **Started:**
  the first gated routes mark reserved usage as failed when downstream work
  throws.
- Idempotency keys prevent duplicate reservations. **Started:** reservations
  use the workspace/idempotency unique key and reuse existing reservations when
  a request key is repeated.

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
   and `/api/billing/portal`; hosted API billing-blocked responses open the
   same panel with context.
9. Stage 5: introduce a worker/job runner for long operations.
10. Stage 6: add admin/support tooling and production observability.
