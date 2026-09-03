/**
 * Alphabetical, case-insensitive label ordering for every surface that
 * enumerates labels (pickers, filter bars, tile rows). Applied at render
 * time so renames and creations re-sort dynamically; never mutates input
 * or the server-side order.
 */
export function sortLabelsByName<T extends { name: string }>(labels: readonly T[]): T[] {
  return [...labels].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}
