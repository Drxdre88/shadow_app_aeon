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
  registerSessionTools,
  registerReflectionTools,
  registerRecipeTools,
  registerSynthesisTools,
  registerAskTools,
  registerDialogueTools,
  registerHangarTools,
  registerVirtualMemberTools,
  registerMemoryOpsTools,
  registerThinkingTools,
  registerBeliefTools,
  registerConstitutionTools,
  registerVoiceNoteTools,
  registerPaidBackupTools,
  registerKairosPromiseTools,
  registerKairosTodayTools,
} from './tools'
import { installTodayUseTracking, tokenFingerprint, tokenKindOf } from '@/lib/kairos/today-mcp-use'

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
    extra: { userId: result.id, role: result.role, tokenKind: tokenKindOf(bearerToken), fp: tokenFingerprint(bearerToken) },
  }
}

const mcpHandler = createMcpHandler(
  (server) => {
    installTodayUseTracking(server)
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
    registerSessionTools(server)
    registerReflectionTools(server)
    registerRecipeTools(server)
    registerSynthesisTools(server)
    registerAskTools(server)
    registerDialogueTools(server)
    registerHangarTools(server)
    registerVirtualMemberTools(server)
    registerMemoryOpsTools(server)
    registerThinkingTools(server)
    registerBeliefTools(server)
    registerConstitutionTools(server)
    registerVoiceNoteTools(server)
    registerPaidBackupTools(server)
    registerKairosPromiseTools(server)
    registerKairosTodayTools(server)
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

// The Max-plan thinking routine claims jobs through MCP; a Sunday claim plans
// concept clusters, so give the shared MCP function the same ceiling as crons.
export const maxDuration = 300

export { handler as GET, handler as POST, handler as DELETE }
