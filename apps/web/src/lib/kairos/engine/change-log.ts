import { insertMemoryOps } from '@/lib/data/memory-ops'
import type { ChangeLog, MemoryOpInput } from './types'

export type MemoryOpsWriter = (userId: string, runId: string | null, ops: readonly MemoryOpInput[]) => Promise<number>

const FLUSH_CHUNK = 500

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
