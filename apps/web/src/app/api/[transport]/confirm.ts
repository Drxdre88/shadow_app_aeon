import { z } from 'zod'
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  acceptedContent,
  inputRequired,
  inputResponse,
} from '@modelcontextprotocol/server'
import type { CallToolResult, ClientCapabilities, InputRequiredResult, ServerContext } from '@modelcontextprotocol/server'
import { verifyProjectOwnership } from '@/lib/data/projects'

export const CONFIRM_KEY = 'confirm'

const confirmationSchema = z.object({
  confirm: z.boolean().meta({ title: 'Yes, go ahead' }),
})

export type BoardNameResolver = (projectId: string, userId: string) => Promise<string | null>

export type ConfirmContext = Pick<ServerContext, 'mcpReq' | 'http'>

const defaultResolveBoardName: BoardNameResolver = async (projectId, userId) =>
  (await verifyProjectOwnership(projectId, userId))?.name ?? null

function envelopeOf(ctx: ConfirmContext): Record<string, unknown> | undefined {
  return ctx.mcpReq.envelope as Record<string, unknown> | undefined
}

export function clientCanConfirm(ctx: ConfirmContext): boolean {
  const envelope = envelopeOf(ctx)
  if (!envelope?.[PROTOCOL_VERSION_META_KEY]) return false
  const caps = envelope[CLIENT_CAPABILITIES_META_KEY] as ClientCapabilities | undefined
  const elicitation = caps?.elicitation as Record<string, unknown> | undefined
  if (!elicitation) return false
  return 'form' in elicitation || Object.keys(elicitation).length === 0
}

function countItems(args: Record<string, unknown>): number {
  return Object.values(args).reduce<number>((n, v) => (Array.isArray(v) ? Math.max(n, v.length) : n), 0)
}

export class ConfirmGate {
  constructor(private readonly resolveBoardName: BoardNameResolver = defaultResolveBoardName) {}

  async message(title: string, args: Record<string, unknown>, userId: string | undefined): Promise<string> {
    const count = countItems(args)
    const action = count > 1 ? `${title} (${count} items)` : title
    const projectId = typeof args.projectId === 'string' ? args.projectId : null
    const board = projectId && userId ? await this.resolveBoardName(projectId, userId).catch(() => null) : null
    const where = board ? ` on board "${board}"` : ''
    return `${action}${where}? This can't be undone.`
  }

  async check(
    title: string,
    args: Record<string, unknown>,
    ctx: ConfirmContext
  ): Promise<{ proceed: true } | { proceed: false; result: CallToolResult | InputRequiredResult }> {
    if (!clientCanConfirm(ctx)) return { proceed: true }
    const view = inputResponse(ctx.mcpReq.inputResponses, CONFIRM_KEY)
    const answer = acceptedContent(ctx.mcpReq.inputResponses, CONFIRM_KEY, confirmationSchema)
    if (answer?.confirm === true) return { proceed: true }
    if ((view.kind === 'elicit' && view.action !== 'accept') || answer?.confirm === false) {
      return { proceed: false, result: cancelled(title) }
    }
    const userId = ctx.http?.authInfo?.extra?.userId as string | undefined
    return {
      proceed: false,
      result: inputRequired({
        inputRequests: {
          [CONFIRM_KEY]: inputRequired.elicit({
            message: await this.message(title, args, userId),
            requestedSchema: confirmationSchema,
          }),
        },
      }),
    }
  }
}

function cancelled(title: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `${title} cancelled by the user — nothing was changed.` }],
    isError: true,
  }
}
