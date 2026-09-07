-- Member avatar styling, wave 2 — text colour and shape join initials, fill
-- colour and display name on the per-realm override row.
--
-- `color` (the fill) already accepts a raw hex, so a full palette needs no
-- schema change there; `text_color` is new so the initials can be dark on a
-- pale fill, and `shape` lets an organisation pick circle / rounded / square.
-- Both are NULLABLE and mean "derive" — white text, circle — so every existing
-- row renders exactly as before.
--
-- Additive and reversible: two columns, one CHECK swapped so the not-empty
-- rule knows about the new columns, one CHECK added for the shape vocabulary.
-- Nothing dropped, nothing backfilled. Safe to re-run.

ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS text_color varchar(20);
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS shape varchar(12);

-- A row with only a shape or a text colour set is still a real override, so
-- the "row exists == has an override" rule has to count the new columns.
ALTER TABLE member_profiles DROP CONSTRAINT IF EXISTS member_profiles_not_empty_check;
ALTER TABLE member_profiles ADD CONSTRAINT member_profiles_not_empty_check
  CHECK (
    initials IS NOT NULL
    OR color IS NOT NULL
    OR display_name IS NOT NULL
    OR text_color IS NOT NULL
    OR shape IS NOT NULL
  );

ALTER TABLE member_profiles DROP CONSTRAINT IF EXISTS member_profiles_shape_check;
ALTER TABLE member_profiles ADD CONSTRAINT member_profiles_shape_check
  CHECK (shape IS NULL OR shape IN ('circle', 'rounded', 'square'));
