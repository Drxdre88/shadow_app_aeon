import { z } from 'zod'
import type { McpServer, ServerContext, ToolAnnotations } from '@modelcontextprotocol/server'
import { fail, type Extra, type ToolServer, type ToolShape } from './tools/types'
import { ConfirmGate } from './confirm'
import { canUseVorath } from '@/lib/vorath-access'

type AnyCallback = (...args: unknown[]) => unknown

type Run = (input: Record<string, unknown> | undefined, ctx: ServerContext) => Promise<never>

function callerId(ctx: ServerContext): string | null {
  const id = ctx.http?.authInfo?.extra?.userId
  return typeof id === 'string' ? id : null
}

type ParsedTool = {
  name: string
  description: string
  shape?: ToolShape
  annotations?: ToolAnnotations
  cb: AnyCallback
}

function isShape(value: unknown): value is ToolShape {
  if (!value || typeof value !== 'object') return false
  const entries = Object.values(value as Record<string, unknown>)
  return entries.length === 0 || entries.every((v) => !!v && typeof v === 'object' && '~standard' in v)
}

export function parseToolArgs(args: unknown[]): ParsedTool {
  const [name, description, ...rest] = args
  if (typeof name !== 'string' || typeof description !== 'string') throw new TypeError('tool(name, description, ...) expected')
  const cb = rest.pop()
  if (typeof cb !== 'function') throw new TypeError(`tool "${name}" is missing its callback`)
  const [first, second] = rest
  if (rest.length === 2) return { name, description, shape: first as ToolShape, annotations: second as ToolAnnotations, cb: cb as AnyCallback }
  if (rest.length === 1) {
    return isShape(first)
      ? { name, description, shape: first, cb: cb as AnyCallback }
      : { name, description, annotations: first as ToolAnnotations, cb: cb as AnyCallback }
  }
  return { name, description, cb: cb as AnyCallback }
}

export function extraFromContext(ctx: ServerContext): Extra {
  return { authInfo: ctx.http?.authInfo, signal: ctx.mcpReq.signal }
}

export type VorathGuard = { vorathTools?: ReadonlySet<string>; ownerTier?: boolean }

const unknownTool = (name: string) => fail(`Tool ${name} not found`)

export class ToolHost implements ToolServer {
  private readonly vorathTools: ReadonlySet<string>
  private readonly ownerTier: boolean

  constructor(
    private readonly server: McpServer,
    private readonly gate: ConfirmGate = new ConfirmGate(),
    guard: VorathGuard = {}
  ) {
    this.vorathTools = guard.vorathTools ?? new Set()
    this.ownerTier = guard.ownerTier ?? true
  }

  tool(...args: unknown[]): void {
    const spec = parseToolArgs(args)
    if (this.vorathTools.has(spec.name) && !this.ownerTier) return
    const run = this.runner(spec)
    const config = {
      description: spec.description,
      ...(spec.annotations ? { annotations: spec.annotations } : {}),
    }
    if (spec.shape) {
      this.server.registerTool(spec.name, { ...config, inputSchema: z.object(spec.shape) }, (input: unknown, ctx: ServerContext) =>
        run(input as Record<string, unknown>, ctx)
      )
    } else {
      this.server.registerTool(spec.name, config, (ctx: ServerContext) => run(undefined, ctx))
    }
  }

  private runner(spec: ParsedTool): Run {
    const run = this.confirmed(spec)
    if (!this.vorathTools.has(spec.name)) return run
    return (input, ctx) => (canUseVorath(callerId(ctx)) ? run(input, ctx) : (unknownTool(spec.name) as never))
  }

  private confirmed(spec: ParsedTool): Run {
    const invoke: Run = (input, ctx) =>
      (input === undefined ? spec.cb(extraFromContext(ctx)) : spec.cb(input, extraFromContext(ctx))) as never
    if (spec.annotations?.destructiveHint !== true) return invoke
    const title = spec.annotations.title ?? spec.name
    return async (input, ctx) => {
      const verdict = await this.gate.check(title, input ?? {}, ctx)
      return verdict.proceed ? invoke(input, ctx) : (verdict.result as never)
    }
  }
}
