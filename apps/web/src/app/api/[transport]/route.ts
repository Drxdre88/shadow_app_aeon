import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { AuthInfo } from '@modelcontextprotocol/server'
import type { McpServer as LegacyMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
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
  registerKairosPredictionTools,
  registerKairosAgendaTools,
  registerKairosStageTools,
  registerKairosSurpriseTools,
  registerKairosIdeaTasteTools,
  registerKairosIdeaAtlasTools,
  registerKairosGateTools,
  registerKairosRapportTools,
  registerKairosTrustTools,
  registerKairosLifeChapterTools,
  registerKairosOwnerModelTools,
} from './tools'
import type { ToolServer } from './tools/types'
import { installTodayUseTracking, tokenFingerprint, tokenKindOf } from '@/lib/kairos/today-mcp-use'
import { MCP_PROFILES, parseProfile, profileGate, type McpProfile } from './profiles'
import { ToolHost } from './tool-host'

const MCP_TRANSPORT = 'mcp'
const SERVER_INFO = { name: 'aeon', version: '2.0.0' }

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

function registerTools(server: ToolServer, profile: McpProfile) {
  installTodayUseTracking(server as unknown as LegacyMcpServer)
  const on = profileGate(profile)
  if (on('board')) registerProjectTools(server)
  if (on('board')) registerColumnTools(server)
  if (on('board')) registerTaskTools(server)
  if (on('board')) registerGanttTools(server)
  if (on('board')) registerLabelTools(server)
  if (on('board')) registerChecklistTools(server)
  if (on('board')) registerCommentTools(server)
  if (on('board')) registerDependencyTools(server)
  if (on('board')) registerAnalyticsTools(server)
  if (on('board')) registerBulkTools(server)
  if (on('board', 'hangar')) registerRealmTools(server)
  if (on('vorath')) registerMemoryTools(server)
  if (on('vorath')) registerDominionTools(server)
  if (on('hangar')) registerSessionTools(server)
  if (on('vorath')) registerReflectionTools(server)
  if (on('vorath')) registerRecipeTools(server)
  if (on('vorath')) registerSynthesisTools(server)
  if (on('vorath')) registerAskTools(server)
  if (on('vorath')) registerDialogueTools(server)
  if (on('hangar')) registerHangarTools(server)
  if (on('board')) registerVirtualMemberTools(server)
  if (on('vorath')) registerMemoryOpsTools(server)
  if (on('vorath')) registerThinkingTools(server)
  if (on('vorath')) registerBeliefTools(server)
  if (on('vorath')) registerConstitutionTools(server)
  if (on('vorath')) registerVoiceNoteTools(server)
  if (on('vorath')) registerPaidBackupTools(server)
  if (on('vorath')) registerKairosPromiseTools(server)
  if (on('vorath')) registerKairosTodayTools(server)
  if (on('vorath')) registerKairosPredictionTools(server)
  if (on('vorath')) registerKairosAgendaTools(server)
  if (on('vorath')) registerKairosStageTools(server)
  if (on('vorath')) registerKairosSurpriseTools(server)
  if (on('vorath')) registerKairosIdeaTasteTools(server)
  if (on('vorath')) registerKairosIdeaAtlasTools(server)
  if (on('vorath')) registerKairosGateTools(server)
  if (on('vorath')) registerKairosRapportTools(server)
  if (on('vorath')) registerKairosTrustTools(server)
  if (on('vorath')) registerKairosLifeChapterTools(server)
  if (on('vorath')) registerKairosOwnerModelTools(server)
}

function buildProfileHandler(profile: McpProfile) {
  const mcpHandler = createMcpHandler(
    (mcpServer) => registerTools(new ToolHost(mcpServer), profile),
    { serverInfo: SERVER_INFO, verboseLogs: false }
  )
  return withMcpAuth(mcpHandler, verifyToken, { required: true })
}

const profileHandlers = new Map<McpProfile, (req: Request) => Promise<Response>>()

function handlerFor(profile: McpProfile) {
  let h = profileHandlers.get(profile)
  if (!h) {
    h = buildProfileHandler(profile)
    profileHandlers.set(profile, h)
  }
  return h
}

function notFound() {
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } })
}

function unknownProfile(requested: string | null) {
  return Response.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32602, message: `Unknown MCP profile "${requested}". Use one of: ${MCP_PROFILES.join(', ')}` },
    },
    { status: 400 }
  )
}

async function handler(req: Request, ctx: { params: Promise<{ transport: string }> }) {
  const { transport } = await ctx.params
  if (transport !== MCP_TRANSPORT) return notFound()
  const url = new URL(req.url)
  const profile = parseProfile(url)
  if (!profile) return unknownProfile(url.searchParams.get('profile'))
  return handlerFor(profile)(req)
}

// The Max-plan thinking routine claims jobs through MCP; a Sunday claim plans
// concept clusters, so give the shared MCP function the same ceiling as crons.
export const maxDuration = 300

export { handler as GET, handler as POST, handler as DELETE }
