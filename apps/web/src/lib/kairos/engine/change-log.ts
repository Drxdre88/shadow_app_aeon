import { insertMemoryOps } from '@/lib/data/memory-ops'
import type { ChangeLog, MemoryOpInput } from './types'

export type MemoryOpsWriter = (userId: string, runId: string | null, ops: readonly MemoryOpInput[]) => Promise<number>

const FLUSH_CHUNK = 500

// The dry-run report of what a run would write. Live engine steps write each
// op inside its mutation's transaction instead (2026-10-01: a run killed at
// maxDuration applied 349 changes whose buffered ops were never flushed);
// MemoryEngine only flushes this as a flagged last resort for a step that
// recorded on a live run.
export class BufferedChangeLog implements ChangeLog {
  private buffer: MemoryOpInput[] = []

  constructor(
    private readonly userId: string,
    readonly runId: string,
    private readonly writer: MemoryOpsWriter = insertMemoryOps,
  ) {}

  record(op: MemoryOpInput): void {
    this.buffer.push(op)
  }

  pending(): readonly MemoryOpInput[] {
    return this.buffer
  }

  async flush(): Promise<number> {
    let written = 0
    while (this.buffer.length > 0) {
      const chunk = this.buffer.slice(0, FLUSH_CHUNK)
      written += await this.writer(this.userId, this.runId, chunk)
      this.buffer = this.buffer.slice(chunk.length)
    }
    return written
  }
}
