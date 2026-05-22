import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser } from '@/lib/api/auth'
import {
  registerProjectTools,
  registerColumnTools,
  registerTaskTools,
  registerGanttTools,
  registerLabelTools,
  registerChecklistTools,
  registerCommentTools,
  registerDependencyTools,
  registerAnalyticsTools,
  registerBulkTools,
  registerRealmTools,
  registerMemoryTools,
  registerDominionTools,
} from './tools'

async function verifyToken(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined
  const fakeReq = new NextRequest('http://localhost', {
    headers: new Headers({ authorization: `Bearer ${bearerToken}` }),
  })
  const result = await authenticateRequest(fakeReq)
  if (!isApiUser(result)) return undefined
  return {
    token: bearerToken,
    clientId: result.id,
    scopes: [result.role],
    extra: { userId: result.id, role: result.role },
  }
}

const mcpHandler = createMcpHandler(
  (server) => {
    registerProjectTools(server)
    registerColumnTools(server)
    registerTaskTools(server)
    registerGanttTools(server)
    registerLabelTools(server)
    registerChecklistTools(server)
    registerCommentTools(server)
    registerDependencyTools(server)
    registerAnalyticsTools(server)
    registerBulkTools(server)
    registerRealmTools(server)
    registerMemoryTools(server)
    registerDominionTools(server)
  },
  { capabilities: {} },
  {
    basePath: '/api',
    verboseLogs: false,
  }
)

const handler = withMcpAuth(
  (req) => mcpHandler(req as unknown as import('next/server').NextRequest),
  verifyToken,
  { required: true }
)

export { handler as GET, handler as POST, handler as DELETE }
