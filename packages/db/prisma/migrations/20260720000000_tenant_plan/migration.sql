-- Tenant plan / entitlement tier (founder decision 2026-07-20). Append-only (rule 11).
-- Existing tenants adopt tsp_grow via the column DEFAULT + NOT NULL backfill — this preserves
-- ALL current behavior (every tenant admin keeps white-label/sub-accounts/API/webhooks), so the
-- rollout is safe. New self-service Direct tenants get their plan from the Stripe webhook; TSP
-- tenants are set by platform_admin.
CREATE TYPE "TenantPlan" AS ENUM (
  'direct_5',
  'direct_10',
  'direct_25',
  'direct_50',
  'direct_100',
  'tsp_start',
  'tsp_grow',
  'tsp_scale',
  'tsp_enterprise'
);

ALTER TABLE "tenants" ADD COLUMN "plan" "TenantPlan" NOT NULL DEFAULT 'tsp_grow';
