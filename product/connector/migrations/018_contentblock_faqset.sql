-- 018: contentblock.faqset_id — join key from FAQ items to their owning page.
--
-- faqitem.faqset_id ↔ contentblock.faqset_id → contentblock.page_id → page
-- lets the inform_chunk compose derive canonical_url + source_title for
-- FAQ-sourced chunks (892/928 source faqitems reach a page). The source
-- `faqset` table is absent from Swoop's dump — and not needed: faqset_id
-- bridges the two tables directly, so NO foreign key is declared here.
--
-- Per planning/03-exec-crosscut-goofy-noether-lookup-url-fix.md (F2 in the
-- 2026-06-11 widget-emptiness diagnosis). Forward-only + idempotent (C.31).

ALTER TABLE contentblock ADD COLUMN IF NOT EXISTS faqset_id INTEGER;

CREATE INDEX IF NOT EXISTS contentblock_faqset_id_idx
  ON contentblock (faqset_id)
  WHERE faqset_id IS NOT NULL;
