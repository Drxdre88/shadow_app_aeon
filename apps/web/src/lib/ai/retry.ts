import { AiCredentialMissingError, AiCredentialDecryptError } from './router'

// Kairos reliability (C2) — a single generic retry wrapper for the bare
// `provider.ask()` synthesis calls. Currently applied to aether-regen
// (`aether.ts`); cortex/archetypes/introspection share the same bare-call
// pattern and can adopt it if their outage class warrants. A transient
// provider hiccup used to fail the whole run for the day; this gives it one
// more chance with a short exponential-ish backoff before bubbling up.
//
// Never retries a missing/undecryptable BYOK credential — that's a
// permanent, not transient, failure and retrying it just wastes the
// remaining attempts before the caller's existing benign-skip handling.

export interface RetryOptions {
  attempts?: number
  baseDelayMs?: number
}

function isCredentialError(err: unknown): boolean {
  return err instanceof AiCredentialMissingError || err instanceof AiCredentialDecryptError
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { attempts = 2, baseDelayMs = 1000 } = opts
  let lastErr: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (isCredentialError(err)) throw err
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt))
      }
    }
  }

  throw lastErr
}
