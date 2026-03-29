import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

export type Extra = { authInfo?: AuthInfo }

export type RegisterFn = (server: McpServer) => void

export function getUserId(extra: Extra): string {
  const uid = extra.authInfo?.extra?.userId as string | undefined
  if (!uid) throw new Error('User not authenticated')
  return uid
}

export const notFound = (entity: string) => ({
  content: [{ type: 'text' as const, text: `${entity} not found` }],
  isError: true as const,
})

export const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
})

export const fail = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true as const,
})
