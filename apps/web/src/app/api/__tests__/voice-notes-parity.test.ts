/**
 * Voice-note MCP <-> REST parity test.
 *
 *   - kairos_voice_note <-> POST /api/v1/kairos/voice-notes
 * Both surfaces share kairosVoiceNoteSchema and stageVoiceNote, bind to the
 * calling user, and neither can confirm a note: confirmation is the owner's
 * tap in Aeon (lib/actions/kairos-voice.ts), never the connector.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const MCP_TOOL_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/voice-note.ts')
const MCP_ROUTE_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/route.ts')
const REST_FILE = path.join(WEB_ROOT, 'src/app/api/v1/kairos/voice-notes/route.ts')
const TOOLS_DIR = path.join(WEB_ROOT, 'src/app/api/[transport]/tools')

const read = (p: string) => readFileSync(p, 'utf8')

describe('Voice-note MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_FILE) ? read(REST_FILE) : ''

  it('registers exactly one tool, kairos_voice_note, in the MCP route', () => {
    expect([...mcpSrc.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])).toEqual(['kairos_voice_note'])
    expect(read(MCP_ROUTE_FILE)).toMatch(/\[registerVoiceNoteTools, \[/)
  })

  it('has the REST twin with POST', () => {
    expect(restSrc, 'missing src/app/api/v1/kairos/voice-notes/route.ts').not.toBe('')
    expect(restSrc).toMatch(/export const POST\b/)
  })

  it('both surfaces use the shared validator and data function', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toMatch(/import \{[^}]*\bkairosVoiceNoteSchema\b[^}]*\} from '@\/lib\/data\/validators\/voice-notes'/)
      expect(src).toMatch(/import \{[^}]*\bstageVoiceNote\b[^}]*\} from '@\/lib\/data\/voice-notes'/)
      expect(src).toMatch(/kairosVoiceNoteSchema\.safeParse\(/)
    }
  })

  it('no connector surface can confirm a voice note or stamp operator origin', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).not.toMatch(/confirmVoiceNote|acceptKairosProposal|acceptProposal|kind: 'operator'/)
    }
    const allTools = readdirSync(TOOLS_DIR).map((f) => read(path.join(TOOLS_DIR, f))).join('\n')
    expect(allTools).not.toMatch(/confirm_kairos_voice_note|confirmVoiceNote/)
  })

  it('MCP binds to the caller and REST authenticates', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
  })
})
