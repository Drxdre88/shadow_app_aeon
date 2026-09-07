/**
 * Realm-wide avatar policy, kept in `workspace_groups.settings.avatars`.
 * `preferInitials` makes every board in the realm show initials instead of
 * photos — the organisation-level switch, as opposed to the per-project one in
 * `projects.settings.avatars` (parsed by `components/board/sizing.ts`, same
 * shape) which it ORs with.
 *
 * Pure so the data layer and client code share it without either importing
 * the other.
 */
export type RealmAvatarPrefs = { preferInitials: boolean }

export function parseRealmAvatarPrefs(settings: unknown): RealmAvatarPrefs {
  const avatars = (settings as { avatars?: unknown } | null | undefined)?.avatars
  if (!avatars || typeof avatars !== 'object' || Array.isArray(avatars)) return { preferInitials: false }
  return { preferInitials: (avatars as { preferInitials?: unknown }).preferInitials === true }
}
