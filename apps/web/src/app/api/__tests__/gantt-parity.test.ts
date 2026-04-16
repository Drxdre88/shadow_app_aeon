/**
 * Gantt MCP <-> REST parity test.
 *
 * The MCP server and REST API must expose the SAME Gantt capabilities so AI
 * agents and external integrations never see divergent surfaces. This test
 * statically verifies:
 *   - every Gantt MCP tool has a matching REST route file on disk
 *   - every Gantt REST route has a matching MCP tool registration
 *   - both surfaces import the same validators from `@/lib/data/validators`
 *
 * Fails loudly if either side drifts.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const MCP_TOOL_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/gantt.ts')
const REST_ROOT = path.join(WEB_ROOT, 'src/app/api/v1/projects/[id]')

const REST_ROUTE_FILES = [
  'gantt/route.ts',
  'gantt/[taskId]/route.ts',
  'gantt/batch/route.ts',
  'rows/route.ts',
  'rows/[rowId]/route.ts',
  'rows/reorder/route.ts',
  'gantt-views/route.ts',
  'gantt-views/[viewId]/route.ts',
]

function readSource(p: string): string {
  return readFileSync(p, 'utf8')
}

function extractToolNames(src: string): string[] {
  const re = /server\.tool\(\s*['"]([a-z_]+)['"]/g
  const names: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) names.push(m[1])
  return names
}

describe('Gantt MCP <-> REST parity', () => {
  const mcpSrc = readSource(MCP_TOOL_FILE)
  const toolNames = extractToolNames(mcpSrc)
  const restSrcConcat = REST_ROUTE_FILES
    .map((p) => readSource(path.join(REST_ROOT, p)))
    .join('\n')

  describe('MCP tool surface', () => {
    // Set equality is the authoritative check — if a tool is added/removed,
    // the expected set here must update too. Hard-coded length assertion
    // dropped per review: set check already fails loudly on drift.
    it('exposes every expected Gantt operation', () => {
      expect(new Set(toolNames)).toEqual(new Set([
        // gantt tasks
        'list_gantt_tasks',
        'create_gantt_task',
        'update_gantt_task',
        'delete_gantt_task',
        'batch_create_gantt_tasks',
        // rows
        'list_rows',
        'create_row',
        'update_row',
        'delete_row',
        'reorder_rows',
        // views
        'list_gantt_views',
        'create_gantt_view',
        'update_gantt_view',
        'delete_gantt_view',
      ]))
    })
  })

  describe('REST route surface', () => {
    const expectedRoutes: Array<{ path: string; methods: string[] }> = [
      // gantt tasks
      { path: 'gantt/route.ts', methods: ['GET', 'POST'] },
      { path: 'gantt/[taskId]/route.ts', methods: ['PUT', 'DELETE'] },
      { path: 'gantt/batch/route.ts', methods: ['POST'] },
      // rows
      { path: 'rows/route.ts', methods: ['GET', 'POST'] },
      { path: 'rows/[rowId]/route.ts', methods: ['PUT', 'DELETE'] },
      { path: 'rows/reorder/route.ts', methods: ['PUT'] },
      // views
      { path: 'gantt-views/route.ts', methods: ['GET', 'POST'] },
      { path: 'gantt-views/[viewId]/route.ts', methods: ['PUT', 'DELETE'] },
    ]

    it.each(expectedRoutes)('has route file + methods: $path', ({ path: routePath, methods }) => {
      const full = path.join(REST_ROOT, routePath)
      expect(existsSync(full), `missing REST route file: ${routePath}`).toBe(true)
      const src = readSource(full)
      for (const m of methods) {
        expect(src, `${routePath} missing export ${m}`).toMatch(new RegExp(`export const ${m}\\b`))
      }
    })
  })

  describe('shared validator usage — MCP and REST speak the same schema', () => {
    const validators = [
      'createGanttTaskSchema',
      'updateGanttTaskSchema',
      'createRowSchema',
      'updateRowSchema',
      'reorderRowsSchema',
      'createGanttViewSchema',
      'updateGanttViewSchema',
    ]

    it.each(validators)('MCP uses validator: %s', (v) => {
      expect(mcpSrc, `MCP gantt.ts missing ${v}`).toMatch(new RegExp(`\\b${v}\\b`))
    })

    it.each(validators)('REST surface uses validator: %s', (v) => {
      expect(restSrcConcat, `REST routes missing ${v}`).toMatch(new RegExp(`\\b${v}\\b`))
    })
  })

  describe('data-function parity — MCP and REST call the same underlying functions', () => {
    const dataFns = [
      // gantt tasks
      'findGanttTasksWithRows',
      'createGanttTask',
      'updateGanttTask',
      'deleteGanttTask',
      'createGanttTasksBatch',
      // rows
      'findRows',
      'createRow',
      'updateRow',
      'deleteRow',
      'reorderRows',
      // views
      'findGanttViews',
      'createGanttView',
      'updateGanttView',
      'deleteGanttView',
    ]

    it.each(dataFns)('MCP imports and uses: %s', (fn) => {
      expect(mcpSrc).toMatch(new RegExp(`\\b${fn}\\b`))
    })

    it.each(dataFns)('REST imports and uses: %s', (fn) => {
      expect(restSrcConcat).toMatch(new RegExp(`\\b${fn}\\b`))
    })
  })

  describe('ownership enforcement — every tool + route verifies project access', () => {
    it('every MCP tool calls requireOwnership', () => {
      const toolBlocks = mcpSrc.split(/server\.tool\(/).slice(1)
      for (const block of toolBlocks) {
        const name = block.match(/['"]([a-z_]+)['"]/)?.[1] ?? '<unknown>'
        expect(block, `MCP tool ${name} missing requireOwnership check`)
          .toMatch(/requireOwnership\(/)
      }
    })

    it('every REST route calls verifyProjectOwnership', () => {
      for (const r of REST_ROUTE_FILES) {
        const src = readSource(path.join(REST_ROOT, r))
        expect(src, `${r} missing verifyProjectOwnership`)
          .toMatch(/verifyProjectOwnership\(/)
      }
    })

    it('batch + reorder operations verify bulk row ownership', () => {
      // batch_create_gantt_tasks + reorder_rows: both MCP and REST
      expect(mcpSrc).toMatch(/verifyRowsOwnership\(/)
      const batchSrc = readSource(path.join(REST_ROOT, 'gantt/batch/route.ts'))
      const reorderSrc = readSource(path.join(REST_ROOT, 'rows/reorder/route.ts'))
      expect(batchSrc).toMatch(/verifyRowsOwnership\(/)
      expect(reorderSrc).toMatch(/verifyRowsOwnership\(/)
    })
  })
})
