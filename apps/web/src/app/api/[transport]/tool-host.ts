import { z } from 'zod'
import type { McpServer, ServerContext, ToolAnnotations } from '@modelcontextprotocol/server'
import type { Extra, ToolServer, ToolShape } from './tools/types'
import { ConfirmGate } from './confirm'

type AnyCallback = (...args: unknown[]) => unknown

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

export class ToolHost implements ToolServer {
  readonly registered: string[] = []

  constructor(
    private readonly server: McpServer,
    private readonly gate: ConfirmGate = new ConfirmGate()
  ) {}

  tool(...args: unknown[]): void {
    const spec = parseToolArgs(args)
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
    this.registered.push(spec.name)
  }

  private runner(spec: ParsedTool) {
    const invoke = (input: Record<string, unknown> | undefined, ctx: ServerContext) =>
      (input === undefined ? spec.cb(extraFromContext(ctx)) : spec.cb(input, extraFromContext(ctx))) as never
    if (spec.annotations?.destructiveHint !== true) return invoke
    const title = spec.annotations.title ?? spec.name
    return async (input: Record<string, unknown> | undefined, ctx: ServerContext) => {
      const verdict = await this.gate.check(title, input ?? {}, ctx)
      return verdict.proceed ? invoke(input, ctx) : (verdict.result as never)
    }
  }
}
