import type { AIProvider, AIRequest, AIResponse, AIUsage, StreamChunk } from './provider'
import type { SpendMeter } from './spend'

export interface MeterContext {
  userId: string
  task: string
  providerId: string
  modelId: string
}

export class MeteredProvider implements AIProvider {
  constructor(
    private readonly inner: AIProvider,
    private readonly ctx: MeterContext,
    private readonly meter: Pick<SpendMeter, 'check' | 'record'>,
    private readonly now: () => number = Date.now,
  ) {}

  get providerId() {
    return this.inner.providerId
  }

  get modelId() {
    return this.inner.modelId
  }

  async ask(req: AIRequest): Promise<AIResponse> {
    await this.meter.check(this.ctx.userId)
    const startedAt = this.now()
    try {
      const response = await this.inner.ask(req)
      this.record(startedAt, true, response.usage)
      return response
    } catch (err) {
      this.record(startedAt, false, undefined, err)
      throw err
    }
  }

  async *stream(req: AIRequest): AsyncIterable<StreamChunk> {
    await this.meter.check(this.ctx.userId)
    const startedAt = this.now()
    let usage: AIUsage | undefined
    let settled = false
    try {
      for await (const chunk of this.inner.stream(req)) {
        if (chunk.usage) usage = chunk.usage
        yield chunk
      }
      settled = true
      this.record(startedAt, true, usage)
    } catch (err) {
      settled = true
      this.record(startedAt, false, usage, err)
      throw err
    } finally {
      if (!settled) this.record(startedAt, false, usage, new Error('stream abandoned'))
    }
  }

  private record(startedAt: number, ok: boolean, usage?: AIUsage, error?: unknown): void {
    try {
      this.meter.record({ ...this.ctx, usage, latencyMs: this.now() - startedAt, ok, ...(ok ? {} : { error }) })
    } catch (err) {
      console.warn('[ai-usage] record failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }
}
