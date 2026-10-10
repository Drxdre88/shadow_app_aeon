import { after } from 'next/server'

// Entity scan on write: after a memory is created or edited, its fk/dict
// mentions are rebuilt in after(), off the write's critical path. Outside a
// request scope (scripts, tests) nothing is scheduled; the backfill CLI covers it.
export function scheduleEntityScan(userId: string, row: { id: string } | null | undefined): boolean {
  if (!row?.id) return false
  const run = async () => {
    try {
      const { rescanMemories } = await import('./scan')
      await rescanMemories(userId, [row.id])
    } catch (err) {
      console.warn('[entities] scan on write failed', {
        memoryId: row.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  try {
    after(run)
    return true
  } catch {
    return false
  }
}
