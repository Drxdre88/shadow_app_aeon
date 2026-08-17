-- The realm-invite fast path now matches lower(users.email) = $1; without a
-- functional index that predicate seq-scans users on every invite.
CREATE INDEX IF NOT EXISTS "users_email_lower_idx" ON "users" (lower("email"));
