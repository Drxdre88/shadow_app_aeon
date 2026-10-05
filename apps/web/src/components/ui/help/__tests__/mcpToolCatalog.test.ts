import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOOL_CATEGORIES, TOTAL_TOOL_COUNT } from '../mcpToolCatalog'

const TOOLS_DIR = join(__dirname, '..', '..', '..', '..', 'app', 'api', '[transport]', 'tools')

function registeredToolNames(): string[] {
  const names = new Set<string>()
  for (const file of readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(join(TOOLS_DIR, file), 'utf8')
    for (const match of source.matchAll(/\.tool\(\s*'([a-z_]+)'/g)) names.add(match[1])
  }
  return [...names].sort()
}

describe('Help → MCP tool roster', () => {
  const listed = TOOL_CATEGORIES.flatMap((c) => c.tools)

  it('lists every tool the MCP server registers, and nothing else', () => {
    expect([...listed].sort()).toEqual(registeredToolNames())
  })

  it('lists each tool once, so the count is honest', () => {
    expect(new Set(listed).size).toBe(listed.length)
    expect(TOTAL_TOOL_COUNT).toBe(listed.length)
  })
})
