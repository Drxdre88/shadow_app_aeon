import type { AIProvider, AIRequest, AIResponse, AIUsage, StreamChunk } from '@/lib/ai/provider'
import type { VoiceTurnClock } from './timing'

// Wraps the owner's paid provider for one voice turn so the reply text
// reaches the voice line as it is produced, while the chat engine still sees
// a plain ask() and keeps its tool loop, guards and persistence unchanged.
//
// - A tool round (request carries tools) is answered by ask(); when the round
//   is the answer (no tool calls) its text is tapped whole.
// - A tool-less call is the answer: it runs through stream() and every chunk
//   is tapped. If stream() fails before any text, it falls back to ask().
// - After the answer is tapped the wrapper disarms, so later calls (the
//   pending-ask classifier) are never spoken.
// - The armed flag is re-checked after every await: a tool round that lost
//   the tool loop's deadline race can still resolve later and must stay
//   silent. seal() (called when the engine returns) silences everything.
// - An optional clock records the first model call, each tool round, the
//   first tapped text, the end of the answer and the prompt size, for the
//   turn timing.
// - onEnd fires once the answer is complete (stream finished, or the whole
//   answer tapped), so the voice line can speak its last piece before the
//   reply is saved.

export class VoiceTapProvider implements AIProvider {
  private armed = true
  private sealed = false
  private called = false
  private usage: AIUsage | undefined

  constructor(
    private readonly inner: AIProvider,
    private readonly onText: (text: string) => void,
    private readonly clock?: VoiceTurnClock,
    private readonly onEnd?: () => void,
  ) {}

  get providerId() {
    return this.inner.providerId
  }

  get modelId() {
    return this.inner.modelId
  }

  // Token usage of the answer call, for the turn log.
  get answerUsage(): AIUsage | undefined {
    return this.usage
  }

  seal(): void {
    this.sealed = true
    this.armed = false
  }

  async ask(req: AIRequest): Promise<AIResponse> {
    if (!this.armed) return this.inner.ask(req)
    this.noteCall(req)
    if (req.tools) {
      const response = await this.inner.ask(req)
      if (this.armed && !response.toolCalls?.length && response.text.trim()) this.tapWhole(response)
      return response
    }
    this.armed = false
    return this.streamAnswer(req)
  }

  stream(req: AIRequest): AsyncIterable<StreamChunk> {
    return this.inner.stream(req)
  }

  private emit(text: string): void {
    if (this.sealed) return
    this.clock?.mark('first_text')
    this.onText(text)
  }

  private noteCall(req: AIRequest): void {
    if (!this.clock) return
    this.clock.count(req.tools ? 'toolRounds' : 'plainCalls')
    if (this.called) return
    this.called = true
    this.clock.mark('model_call')
    this.clock.note('promptChars', (req.messages ?? []).reduce((n, m) => n + m.content.length, 0))
  }

  private end(): void {
    if (this.sealed) return
    this.clock?.mark('answer_end')
    this.onEnd?.()
  }

  private tapWhole(response: AIResponse): void {
    this.armed = false
    this.usage = response.usage
    this.emit(response.text)
    this.end()
  }

  private async streamAnswer(req: AIRequest): Promise<AIResponse> {
    let text = ''
    let finishReason: string | undefined
    try {
      for await (const chunk of this.inner.stream(req)) {
        if (chunk.text) {
          text += chunk.text
          this.emit(chunk.text)
        }
        if (chunk.usage) this.usage = chunk.usage
        if (chunk.finishReason) finishReason = chunk.finishReason
      }
    } catch (err) {
      if (text) throw err
      console.warn('[kairos-voice] stream failed before any text, answering with ask()', {
        error: err instanceof Error ? err.message : String(err),
      })
      const response = await this.inner.ask(req)
      this.tapWhole(response)
      return response
    }
    this.end()
    return { text, providerId: this.inner.providerId, modelId: this.inner.modelId, usage: this.usage, ...(finishReason ? { finishReason } : {}) }
  }
}
