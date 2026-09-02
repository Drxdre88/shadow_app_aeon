-- Per-realm display overrides for REAL members — the initials, colour and name
-- an avatar renders, chosen by the realm's owner rather than derived.
--
-- Why a table and not columns on `users`: `users.name` and `users.image` are
-- global identity, owned by the person and populated by their OAuth provider.
-- One realm owner must not be able to rewrite how someone appears in another
-- team's realm. Scoping to (realm_id, user_id) mirrors virtual_members, which
-- is already realm-scoped for exactly the same reason.
--
-- Every column is NULLABLE and means "no override — fall back to the derived
-- value". A row with nothing set is meaningless, so the CHECK forbids it and
-- the action deletes the row when the last override is cleared. That keeps
-- "has an override" answerable by the row's existence.

CREATE TABLE IF NOT EXISTS member_profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_id       uuid NOT NULL REFERENCES workspace_groups(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL = derive from the display name, then the account name, then the email.
  initials       varchar(4),
  -- NULL = the hue currently derived from the seed, so unset members keep
  -- exactly the avatar they have today.
  color          varchar(20),
  -- NULL = users.name. Overriding it is how a magic-link signup — who has no
  -- name at all — gets one without touching their account.
  display_name   varchar(120),
  created_by_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now(),

  CONSTRAINT member_profiles_not_empty_check
    CHECK (initials IS NOT NULL OR color IS NOT NULL OR display_name IS NOT NULL),
  -- varchar(4) caps the storage; this forbids the empty string, which would
  -- render as a blank avatar and read as "override set" to every caller.
  CONSTRAINT member_profiles_initials_length_check
    CHECK (initials IS NULL OR char_length(initials) BETWEEN 1 AND 4),
  CONSTRAINT member_profiles_display_name_length_check
    CHECK (display_name IS NULL OR char_length(btrim(display_name)) > 0)
);

-- One override per person per realm. Also the lookup index: every read is
-- "the overrides for this realm", and joins land on (realm_id, user_id).
CREATE UNIQUE INDEX IF NOT EXISTS member_profiles_realm_user_key
  ON member_profiles (realm_id, user_id);
