// ─────────────────────────────────────────────────────────────────────────
// Brain Phase 4 (P2) — embedding provider for semantic memory retrieval.
//
// Single server-managed key (NOT the per-user BYOK chat keys — the embedding
// index is app-owned, not per-user generation). Provider resolved from env:
//   VOYAGE_API_KEY  → voyage-3.5 @ 1024 dims (primary; asymmetric query/doc)
//   OPENAI_API_KEY  → text-embedding-3-small truncated to 1024 (fallback)
//   (neither)       → embeddings disabled; retrieval degrades to pure FTS.
//
// All vectors are 1024-dim so the pgvector column type is fixed regardless of
// provider. Embeddings from different models are NOT comparable — the active
// model is stamped on each row (memories.embedding_model) so the backfill can
// detect drift and re-embed. Keep ONE provider active for a given corpus.
//
// Raw fetch (no SDK): keeps this self-contained and gives reliable control of
// Voyage's input_type / output_dimension, which the AI-SDK provider wrappers
// expose inconsistently.
// ─────────────────────────────────────────────────────────────────────────

export const EMBEDDING_DIMENSIONS = 1024

export type EmbeddingInputType = 'query' | 'document'

type Provider =
  | { kind: 'voyage'; key: string; model: 'voyage-3.5' }
  | { kind: 'openai'; key: string; model: 'text-embedding-3-small' }
  | null

function resolveProvider(): Provider {
  const voyage = process.env.VOYAGE_API_KEY
  if (voyage) return { kind: 'voyage', key: voyage, model: 'voyage-3.5' }
  const openai = process.env.OPENAI_API_KEY
  if (openai) return { kind: 'openai', key: openai, model: 'text-embedding-3-small' }
  return null
}

export function embeddingsEnabled(): boolean {
  return resolveProvider() !== null
}

// Stamp written to memories.embedding_model. Lets the backfill re-embed rows
// whose vector came from a different provider/model than the active one.
export function activeEmbeddingModel(): string | null {
  const p = resolveProvider()
  return p ? `${p.kind}:${p.model}` : null
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>
}

async function embedVoyage(key: string, texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'voyage-3.5',
      input: texts,
      input_type: inputType,
      output_dimension: EMBEDDING_DIMENSIONS,
      output_dtype: 'float',
    }),
  })
  if (!res.ok) throw new Error(`voyage ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = (await res.json()) as EmbeddingResponse
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
}

async function embedOpenai(key: string, texts: string[]): Promise<number[][]> {
  // OpenAI 3-small has no asymmetric mode; `dimensions` truncates via MRL.
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  })
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = (await res.json()) as EmbeddingResponse
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
}

// Embed a batch. Returns null when no provider is configured (callers degrade
// to FTS-only). Throws on a configured provider's API error so callers can
// decide whether to catch + fall back.
export async function embedTexts(
  texts: string[],
  inputType: EmbeddingInputType,
): Promise<number[][] | null> {
  const provider = resolveProvider()
  if (!provider) return null
  if (texts.length === 0) return []
  // Clip per-input to keep well under provider token limits (~32k tokens).
  const clipped = texts.map((t) => (t.length > 24000 ? t.slice(0, 24000) : t))
  return provider.kind === 'voyage'
    ? embedVoyage(provider.key, clipped, inputType)
    : embedOpenai(provider.key, clipped)
}

export async function embedOne(text: string, inputType: EmbeddingInputType): Promise<number[] | null> {
  const out = await embedTexts([text], inputType)
  return out ? out[0] ?? null : null
}

// pgvector literal form ('[0.1,0.2,...]') for raw SQL casts (`$1::vector`).
// Drizzle's vector() column accepts number[] directly on writes; this is only
// needed for the ORDER BY ... <=> expression in the search query.
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`
}
