import { renderChapterContinuity } from './render'

// Mode 1 continuity: the last chapter as a short context block for the
// reflect prompt. Lazy data import; any failure → undefined (reflect is
// unchanged). Never citable, never carries lintHits.
export async function loadChapterContinuity(userId: string): Promise<string | undefined> {
  try {
    const { listLifeChapters } = await import('@/lib/data/life-chapters')
    const [row] = await listLifeChapters(userId, { limit: 1 })
    return row?.chapter ? renderChapterContinuity(row.chapter) : undefined
  } catch (err) {
    console.warn('[kairos:life-chapter] continuity read failed:', err instanceof Error ? err.message : String(err))
    return undefined
  }
}
