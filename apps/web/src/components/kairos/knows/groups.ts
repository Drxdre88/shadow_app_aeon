// Group "What Vorath knows" rows by area (Dominion). Unfiled rows go last.

export type GroupableRow = {
  id: string
  dominionId: string | null
  dominionName: string | null
  dominionColor?: string | null
}

export type KnownGroup<T extends GroupableRow> = {
  key: string
  name: string
  color: string | null
  rows: T[]
}

export const UNFILED_GROUP_NAME = 'Not in an area yet'

export function groupByDominion<T extends GroupableRow>(rows: readonly T[]): KnownGroup<T>[] {
  const groups = new Map<string, KnownGroup<T>>()
  for (const row of rows) {
    const key = row.dominionId && row.dominionName ? row.dominionId : '__unfiled'
    let group = groups.get(key)
    if (!group) {
      group = key === '__unfiled'
        ? { key, name: UNFILED_GROUP_NAME, color: null, rows: [] }
        : { key, name: row.dominionName as string, color: row.dominionColor ?? null, rows: [] }
      groups.set(key, group)
    }
    group.rows.push(row)
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === '__unfiled') return 1
    if (b.key === '__unfiled') return -1
    return b.rows.length - a.rows.length || a.name.localeCompare(b.name)
  })
}
