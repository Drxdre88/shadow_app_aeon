// The board Archive switch. Client-safe: no db imports here; the SQL
// predicate lives in lib/data/project-archive.ts.

export const PROJECT_ARCHIVED_SETTING = 'archived'
export const PROJECT_ARCHIVED_AT_SETTING = 'archivedAt'

export interface ArchivedProjectView {
  id: string
  name: string
  archivedAt: string | null
}

export function isProjectArchived(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') return false
  return (settings as Record<string, unknown>)[PROJECT_ARCHIVED_SETTING] === true
}

export function projectArchivedAt(settings: unknown): string | null {
  if (!isProjectArchived(settings)) return null
  const at = (settings as Record<string, unknown>)[PROJECT_ARCHIVED_AT_SETTING]
  return typeof at === 'string' ? at : null
}
