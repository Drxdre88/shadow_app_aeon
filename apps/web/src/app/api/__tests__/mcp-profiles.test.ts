import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MCP_PROFILES, parseProfile, profileGate } from '../[transport]/profiles'

const ROUTE = path.resolve(__dirname, '../[transport]/route.ts')
const HELP = path.resolve(__dirname, '../../../components/ui/help/McpProfilesSection.tsx')

const at = (q: string) => parseProfile(new URL(`https://aeon.example/api/mcp${q}`))

describe('MCP tool profiles', () => {
  it('defaults to the full tool set', () => {
    expect(at('')).toBe('all')
    expect(at('?profile=')).toBe('all')
    expect(at('?profile=all')).toBe('all')
  })

  it('accepts each slim profile case-insensitively and kairos as a vorath alias', () => {
    expect(at('?profile=Board')).toBe('board')
    expect(at('?profile=hangar')).toBe('hangar')
    expect(at('?profile=vorath')).toBe('vorath')
    expect(at('?profile=kairos')).toBe('vorath')
  })

  it('rejects unknown profiles', () => {
    expect(at('?profile=everything')).toBeNull()
  })

  it('all includes every group; slim profiles include only their own', () => {
    expect(profileGate('all')('board')).toBe(true)
    expect(profileGate('board')('board', 'hangar')).toBe(true)
    expect(profileGate('board')('vorath')).toBe(false)
  })

  it('every slim profile gates at least one tool group in the route', () => {
    const src = readFileSync(ROUTE, 'utf8')
    for (const p of MCP_PROFILES.filter((x) => x !== 'all')) {
      expect(src, p).toMatch(new RegExp(`on\\([^)]*'${p}'[^)]*\\)\\) register\\w+Tools\\(server\\)`))
    }
  })

  it('documents every profile in the in-app MCP help', () => {
    const help = readFileSync(HELP, 'utf8')
    for (const p of MCP_PROFILES) expect(help, p).toContain(`id: '${p}'`)
  })
})
