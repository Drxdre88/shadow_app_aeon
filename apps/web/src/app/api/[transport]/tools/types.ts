import type { z } from 'zod'
import type { AuthInfo, CallToolResult, ToolAnnotations } from '@modelcontextprotocol/server'

export type Extra = { authInfo?: AuthInfo; signal?: AbortSignal }

export type ToolShape = z.ZodRawShape

type Awaitable<T> = T | Promise<T>

export type ToolCallback<S extends ToolShape> = (args: z.infer<z.ZodObject<S>>, extra: Extra) => Awaitable<CallToolResult>

export type NoArgToolCallback = (extra: Extra) => Awaitable<CallToolResult>

export interface ToolServer {
  tool(name: string, description: string, cb: NoArgToolCallback): void
  tool<S extends ToolShape>(name: string, description: string, shape: S, cb: ToolCallback<S>): void
  tool<S extends ToolShape>(name: string, description: string, shape: S, annotations: ToolAnnotations, cb: ToolCallback<S>): void
}

export type RegisterFn = (server: ToolServer) => void

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
  content: [{ type: 'text' as const, text: JSON.stringify(data ?? { success: true }) }],
})

export const fail = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true as const,
})
