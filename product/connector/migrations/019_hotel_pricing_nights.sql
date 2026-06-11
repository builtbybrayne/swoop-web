-- Migration 019 — add `nights` column to hotel_pricing
--
-- Context: hotel_pricing.price stores a *package* price for N nights, not a
-- per-night rate. The `nights` column (already in the source MariaDB schema)
-- was absent from the puma_dev flatten, causing MIN(price) to be mislabelled
-- as a nightly rate — a wrong-by-N× error. This migration adds the column so
-- the ETL can carry it faithfully; per-night derivation happens at query time.
--
-- Also adds a column comment to `price` to make the package semantics
-- permanently discoverable at the DB level.
--
-- Forward-only (no DOWN): puma_dev is dev-only and can be rebuilt from scratch.
-- Idempotent via ADD COLUMN IF NOT EXISTS.
--
-- Plan: planning/03-exec-crosscut-goofy-goldstine-pricing-data.md §2.1.
-- Decision: C.goofy-goldstine-2 (per-night derivation at query time, not ETL).

ALTER TABLE hotel_pricing ADD COLUMN IF NOT EXISTS nights INTEGER;

COMMENT ON COLUMN hotel_pricing.price IS
  'Package price for `nights` nights in `season` for `room_id`, in `currency_code`, exactly as authored in the Swoop CMS. NOT per-night. Per-night derivation happens at read time (price::numeric / NULLIF(nights, 0)).';
