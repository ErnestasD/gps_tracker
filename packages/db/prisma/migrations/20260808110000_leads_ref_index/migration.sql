-- The partner funnel counts a partner's enquiries with `lower(ref) = lower($1)` on every dashboard
-- load. `leads` had exactly one index (createdAt), so that was a sequential scan — and a plain index
-- on `ref` would not have been used either: `lower(ref)` needs a FUNCTIONAL index, the same shape
-- `affiliates` already carries on `lower(code)` for attribution.
CREATE INDEX IF NOT EXISTS "leads_ref_lower_idx" ON "leads" (lower("ref"));
