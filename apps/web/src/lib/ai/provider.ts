import { generateText, streamText, tool as sdkTool, type LanguageModel } from 'ai'
import type { z } from 'zod'
import type { AiTier, ProviderId } from './providers'
import { getModelForUser, buildModelWithKey } from './router'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 1 (B6) — AIProvider seam.
//
// Vendor-neutral envelope for every engine Kairos can dispatch to. The
// Vercel AI SDK already gives us a `LanguageModel` abstraction for
// Anthropic / OpenAI / Google / OpenRouter; this layer wraps that AND makes
// room for non-SDK engines (STAF over HTTP, Codex via subprocess, Ollama
// local) so the Engine Router (B10) treats them all the same.
//
// Ported from shadow_dev_lab/packages/sl-shadow-ai/src/sl_shadow_ai/provider.py.
// ─────────────────────────────────────────────────────────────────────────

export type AIRole = 'system' | 'user' | 'assistant'

export interface AIMessage {
  role: AIRole
  content: string
}

// Additive tool-calling seam (Kairos WP2). A request MAY declare read-only
// tools; the provider forwards the definitions to the model but NEVER
// executes them — requested calls surface on AIResponse.toolCalls and the
// caller owns the loop. Call sites that don't pass `tools` are untouched.
export interface AIToolSpec {
  description: string
  inputSchema: z.ZodType
}

export interface AIToolCall {
  toolCallId: string
  toolName: string
  input: unknown
}

export interface AIRequest {
  prompt?: string
  system?: string
  messages?: AIMessage[]
  // Mark `system` as a static, cacheable prefix. On the Anthropic BYOK path
  // this places a prompt-caching breakpoint (cache_control: ephemeral) on the
  // system block so repeated calls in a run reuse it; other providers ignore
  // the namespaced option, so it is a no-op for them.
  cacheSystem?: boolean
  maxOutputTokens?: number
  maxTokens?: number
  temperature?: number
  stopSequences?: string[]
  // Free-form metadata propagated through the request; useful for routing
  // decisions (taskType, sensitivity, dominionId, etc.) and for downstream
  // accounting. Providers can ignore or read as they see fit.
  meta?: Record<string, unknown>
  tools?: Record<string, AIToolSpec>
}

export interface AIUsage {
  inputTokens?: number
  outputTokens?: number
  // USD; populated when the provider knows its own pricing. Router/budget
  // layer can recompute from per-provider pricing if absent.
  costUsd?: number
}

export interface AIResponse {
  text: string
  providerId: ProviderId | string
  modelId: string
  usage?: AIUsage
  finishReason?: string
  // Tool calls the model requested this turn (only when the request carried
  // `tools`). Empty/absent means the model answered with text.
  toolCalls?: AIToolCall[]
  raw?: unknown
}

export interface StreamChunk {
  text: string
  providerId: ProviderId | string
  modelId: string
  done?: boolean
  usage?: AIUsage
}

export interface AIProvider {
  readonly providerId: ProviderId | string
  readonly modelId: string
  ask(req: AIRequest): Promise<AIResponse>
  stream(req: AIRequest): AsyncIterable<StreamChunk>
}

// Anthropic prompt-caching breakpoint for the static prefix. GUARDRAIL: cache
// hits are an exact byte-prefix match — the `system` string sent with
// cacheSystem MUST stay fully static across calls (no dates, names, IDs, or
// other per-run interpolation), or every call silently misses the cache.
// Non-Anthropic providers only read their own providerOptions namespace, so
// this is a no-op for them.
const ANTHROPIC_CACHE_PREFIX = {
  anthropic: { cacheControl: { type: 'ephemeral' as const } },
}

// Execute-less SDK tool definitions: without `execute` the SDK returns the
// model's requested calls instead of running a step loop, keeping loop
// ownership (round caps, result serialization) with the caller.
function toSdkTools(tools: Record<string, AIToolSpec>) {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [
      name,
      sdkTool({ description: t.description, inputSchema: t.inputSchema }),
    ]),
  )
}

// Convert AIRequest into Vercel SDK kwargs. Either prompt or messages must
// be provided; messages take precedence.
function toSdkArgs(model: LanguageModel, req: AIRequest) {
  const base = {
    model,
    system: req.system,
    // AI SDK v5 renamed this option; the old `maxTokens` key is silently
    // ignored, which disables every per-call output cap (found 2026-07-15).
    maxOutputTokens: req.maxOutputTokens ?? req.maxTokens,
    temperature: req.temperature,
    stopSequences: req.stopSequences,
    ...(req.tools ? { tools: toSdkTools(req.tools) } : {}),
  }
  if (req.messages) {
    return { ...base, messages: req.messages.map((m) => ({ role: m.role, content: m.content })) }
  }
  if (req.system && req.cacheSystem) {
    // System moves into the messages array so the cache_control breakpoint
    // can ride on it as a per-message provider option.
    return {
      ...base,
      system: undefined,
      messages: [
        { role: 'system' as const, content: req.system, providerOptions: ANTHROPIC_CACHE_PREFIX },
        { role: 'user' as const, content: req.prompt ?? '' },
      ],
    }
  }
  return { ...base, prompt: req.prompt ?? '' }
}

// Vercel-SDK-backed implementation. Used for any provider exposed via
// @ai-sdk/* (Anthropic, OpenAI, Google, OpenRouter via OpenAI-compatible).
export class VercelAIProvider implements AIProvider {
  constructor(
    readonly providerId: ProviderId | string,
    readonly modelId: string,
    private readonly model: LanguageModel,
  ) {}

  async ask(req: AIRequest): Promise<AIResponse> {
    const result = await generateText(toSdkArgs(this.model, req))
    const toolCalls = (result.toolCalls ?? []).map((c) => ({
      toolCallId: c.toolCallId,
      toolName: c.toolName,
      input: c.input as unknown,
    }))
    return {
      text: result.text,
      providerId: this.providerId,
      modelId: this.modelId,
      usage: result.usage
        ? { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
        : undefined,
      finishReason: result.finishReason,
      ...(toolCalls.length ? { toolCalls } : {}),
      raw: result,
    }
  }

  async *stream(req: AIRequest): AsyncIterable<StreamChunk> {
    const result = streamText(toSdkArgs(this.model, req))
    for await (const part of result.textStream) {
      yield { text: part, providerId: this.providerId, modelId: this.modelId }
    }
    const final = await result.usage
    yield {
      text: '',
      providerId: this.providerId,
      modelId: this.modelId,
      done: true,
      usage: final
        ? { inputTokens: final.inputTokens, outputTokens: final.outputTokens }
        : undefined,
    }
  }
}

// Factory: resolve a user's tier preference through the BYOK router and
// return a ready-to-call AIProvider. The Briefer (E20) calls this with
// tier='heavy' for daily inference.
export async function getProviderForUser(userId: string, tier: AiTier): Promise<AIProvider> {
  const model = await getModelForUser(userId, tier)
  // The router resolves the actual providerId + modelId internally; for the
  // envelope we re-resolve from the user's preferences. Cheap dual-lookup
  // is acceptable here — getModelForUser already paid the DB round-trip.
  // For Phase 1 we surface a generic 'byok' marker; B10's policy table
  // overrides this with the chosen provider/model on a per-call basis.
  return new VercelAIProvider('byok', `tier:${tier}`, model)
}

// Direct constructor for when caller has already picked provider + key —
// useful for the credential-test route and for the Engine Router (B10)
// once it carries its own policy resolution.
export async function getProviderWithKey(
  providerId: ProviderId,
  modelId: string,
  apiKey: string,
): Promise<AIProvider> {
  const model = await buildModelWithKey(providerId, modelId, apiKey)
  return new VercelAIProvider(providerId, modelId, model)
}
