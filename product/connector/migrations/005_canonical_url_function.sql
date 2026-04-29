-- 005_canonical_url_function.sql
-- ----------------------------------------------------------------------------
-- canonical_url(override_url, alias) — single source of truth for "the URL we
-- show the visitor when they want to go see this page".
--
-- Rule (decision C.15): canonical_url = override_url IF override_url IS NOT NULL
-- AND override_url <> '', else alias. Treats empty string as absent — the dump
-- has '' rather than NULL for some rows.
--
-- Having this as a function rather than scattered CASE statements keeps
-- export.sql (C.t3) clean and means a future rule change (e.g. URL prefixing,
-- locale-aware paths) lands in one place.
--
-- IMMUTABLE because output depends only on inputs; PARALLEL SAFE so query
-- planners can use it inside parallel scans.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION canonical_url(override_url TEXT, alias TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN override_url IS NOT NULL AND override_url <> '' THEN override_url
    ELSE alias
  END;
$$;
