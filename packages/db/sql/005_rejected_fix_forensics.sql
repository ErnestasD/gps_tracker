-- Keep the evidence for a fix WE rejected — not for every no-fix record.
--
-- On 2026-08-20 a device reported 0/0 with 37 satellites and the platform believed it. Asked
-- "was that the device or our parser?", the honest answer was "we cannot know": the decoded fields
-- are all we store, and the frame they came from is gone the moment it is parsed. That answer is
-- acceptable once.
--
-- The distinction that makes this cheap: a record where the DEVICE says it has no fix
-- (satellites = 0, PROJECT_PLAN §3.4) is ordinary and frequent — 40 in a week from one device —
-- and needs no evidence, because nothing surprising happened. A record we reject DESPITE the device
-- claiming a fix is the rare, surprising one: 34 in that same week, and the only kind anyone will
-- ever want the bytes for.
--
--   reject_reason  why WE refused a fix the device presented as good ('null_island'). NULL for every
--                  ordinary record, including the §3.4 no-fix ones.
--   raw            the AVL record exactly as it arrived, written only alongside a reject_reason.
--
-- Both nullable, so an ordinary row costs one bit in the null bitmap and nothing else; the hot-path
-- INSERT (rule 1, ADR-008) keeps its shape and simply carries two more parameters.
ALTER TABLE positions ADD COLUMN IF NOT EXISTS reject_reason text;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS raw bytea;

-- Support's actual question is "show me the surprising ones for this device", and it is asked
-- rarely — a partial index keeps that answerable without paying for it on every ordinary insert.
CREATE INDEX IF NOT EXISTS positions_rejected_idx
    ON positions (device_id, fix_time DESC)
 WHERE reject_reason IS NOT NULL;
