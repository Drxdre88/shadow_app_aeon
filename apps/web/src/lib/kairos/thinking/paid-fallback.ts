import { getProviderForUser } from '@/lib/ai/provider'
import { AiCredentialDecryptError, AiCredentialMissingError } from '@/lib/ai/router'
import { ParseRepairError, parseWithRepair } from '@/lib/kairos/_prompt-utils'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

// Paid-key fallback shared by thinking-job handlers: one heavy-tier call with
// the job's own prompt, then parse (with one repair round-trip). A missing or
// undecryptable BYOK key declines; any other provider error propagates.

export type PaidParse<T> = { ok: true; value: T } | { ok: false; reason: string }

const MAX_REASON_CHARS = 500

export interface PaidParseOptions<T> {
  parse: (text: string) => T
  label: string
  maxTokens: number
  repairContext: string
  // Prefix of the decline reason when the repaired output is still rejected
  // (default `${label} rejected: `).
  reasonPrefix?: string
}

export async function askPaidAndParse<T>(job: ThinkingJobRow, opts: PaidParseOptions<T>): Promise<PaidParse<T>> {
  let provider: Awaited<ReturnType<typeof getProviderForUser>>
  let rawText: string
  try {
    provider = await getProviderForUser(job.userId, 'heavy')
    const res = await provider.ask({ system: job.input.system, prompt: job.input.prompt, cacheSystem: true, maxTokens: opts.maxTokens })
    rawText = res.text.trim()
  } catch (err) {
    if (err instanceof AiCredentialMissingError) return { ok: false, reason: 'no BYOK credential' }
    if (err instanceof AiCredentialDecryptError) return { ok: false, reason: 'key undecryptable' }
    throw err
  }
  if (!rawText) return { ok: false, reason: 'empty model response' }
  try {
    const value = await parseWithRepair({
      provider,
      rawText,
      parse: opts.parse,
      generatorLabel: opts.label,
      maxTokens: opts.maxTokens,
      system: job.input.system,
      repairContext: opts.repairContext,
    })
    return { ok: true, value }
  } catch (err) {
    if (err instanceof ParseRepairError) {
      const prefix = opts.reasonPrefix ?? `${opts.label} rejected: `
      return { ok: false, reason: `${prefix}${err.message}`.slice(0, MAX_REASON_CHARS) }
    }
    throw err
  }
}
