-- Fuel-theft detection (V2). Add the rule kind; the value is not USED in this migration
-- (ALTER TYPE ADD VALUE is append-only, safe outside a value-using transaction).
ALTER TYPE "RuleKind" ADD VALUE IF NOT EXISTS 'fuel_theft';
