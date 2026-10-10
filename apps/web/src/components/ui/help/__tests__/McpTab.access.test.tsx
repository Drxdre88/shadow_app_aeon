/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { vorathSession } from '@/hooks/testing/vorathSession'
import { McpTab } from '../McpTab'
import { TOTAL_TOOL_COUNT, visibleToolCategories } from '../mcpToolCatalog'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('McpTab access', () => {
  it('shows the owner every tool, profile and Vorath mention', () => {
    render(<McpTab />, { wrapper: vorathSession('owner') })
    expect(screen.getByText(`Available Tools (${TOTAL_TOOL_COUNT})`)).toBeTruthy()
    expect(screen.getByText('create_memory')).toBeTruthy()
    expect(screen.getByText('/api/mcp?profile=vorath')).toBeTruthy()
    expect(screen.getByText('/api/mcp?profile=hangar')).toBeTruthy()
    expect(document.body.textContent).toMatch(/Vorath/)
  })

  it('shows a beta tester no Vorath, Hangar or memory trace', () => {
    render(<McpTab />, { wrapper: vorathSession('tester') })
    const visible = visibleToolCategories(false).reduce((n, c) => n + c.tools.length, 0)
    expect(visible).toBeLessThan(TOTAL_TOOL_COUNT)
    expect(screen.getByText(`Available Tools (${visible})`)).toBeTruthy()
    expect(screen.getByText('list_projects')).toBeTruthy()
    expect(screen.queryByText('/api/mcp?profile=vorath')).toBeNull()
    expect(screen.queryByText('/api/mcp?profile=hangar')).toBeNull()
    expect(document.body.textContent).not.toMatch(/vorath|kairos|hangar|dominion|memor/i)
  })
})
