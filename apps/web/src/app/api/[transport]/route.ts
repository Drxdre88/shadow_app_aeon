import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { AuthInfo } from '@modelcontextprotocol/server'
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
  registerKairosRepoHandoverTools,
  registerHangarPaybackTools,
  registerKairosCardTreeTools,
  registerKairosDecisionTools,
  registerCardForecastTools,
  registerKairosCockpitTools,
} from './tools'
import type { RegisterFn, ToolServer } from './tools/types'
import { installTodayUseTracking, tokenFingerprint, tokenKindOf } from '@/lib/kairos/today-mcp-use'
import { MCP_PROFILES, parseProfile, profileGate, type McpProfile, type SlimProfile } from './profiles'
import { ToolHost } from './tool-host'

const MCP_TRANSPORT = 'mcp'
const SERVER_INFO = { name: 'aeon', version: '2.0.0' }

type ToolGroup = readonly [RegisterFn, readonly [SlimProfile, ...SlimProfile[]]]

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

const TOOL_GROUPS: readonly ToolGroup[] = [
  [registerProjectTools, ['board']],
  [registerColumnTools, ['board']],
  [registerTaskTools, ['board', 'hangar']],
  [registerGanttTools, ['board']],
  [registerLabelTools, ['board']],
  [registerChecklistTools, ['board']],
  [registerCommentTools, ['board']],
  [registerDependencyTools, ['board']],
  [registerAnalyticsTools, ['board']],
  [registerBulkTools, ['board']],
  [registerRealmTools, ['board', 'hangar']],
  [registerMemoryTools, ['vorath', 'hangar']],
  [registerDominionTools, ['vorath']],
  [registerSessionTools, ['hangar']],
  [registerReflectionTools, ['vorath']],
  [registerRecipeTools, ['vorath']],
  [registerSynthesisTools, ['vorath']],
  [registerAskTools, ['vorath']],
  [registerDialogueTools, ['vorath']],
  [registerHangarTools, ['hangar']],
  [registerVirtualMemberTools, ['board']],
  [registerMemoryOpsTools, ['vorath']],
  [registerThinkingTools, ['vorath']],
  [registerBeliefTools, ['vorath']],
  [registerConstitutionTools, ['vorath']],
  [registerVoiceNoteTools, ['vorath']],
  [registerPaidBackupTools, ['vorath']],
  [registerKairosPromiseTools, ['vorath']],
  [registerKairosTodayTools, ['vorath']],
  [registerKairosPredictionTools, ['vorath']],
  [registerKairosAgendaTools, ['vorath']],
  [registerKairosStageTools, ['vorath']],
  [registerKairosSurpriseTools, ['vorath']],
  [registerKairosIdeaTasteTools, ['vorath']],
  [registerKairosIdeaAtlasTools, ['vorath']],
  [registerKairosGateTools, ['vorath']],
  [registerKairosRapportTools, ['vorath']],
  [registerKairosTrustTools, ['vorath']],
  [registerKairosLifeChapterTools, ['vorath']],
  [registerKairosOwnerModelTools, ['vorath']],
  [registerKairosRepoHandoverTools, ['vorath', 'hangar']],
  [registerHangarPaybackTools, ['vorath', 'hangar']],
  [registerKairosCardTreeTools, ['vorath']],
  [registerKairosDecisionTools, ['vorath']],
  [registerCardForecastTools, ['board']],
  [registerKairosCockpitTools, ['vorath']],
]

function registerTools(server: ToolServer, profile: McpProfile) {
  installTodayUseTracking(server)
  const on = profileGate(profile)
  for (const [register, profiles] of TOOL_GROUPS) if (on(...profiles)) register(server)
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
