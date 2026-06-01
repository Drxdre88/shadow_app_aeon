#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Kairos board backfill — one-shot import of every Aeon board task as a
// Kairos memory, plus a rollup memory per project.
//
// Idempotent: each memory carries sourceMetadata.externalId =
//   `board-task:${taskId}` or `project-rollup:${projectId}`. Re-runs hit
//   /api/v1/memories/capture which short-circuits when the externalId
//   already exists.
//
// Usage:
//   node apps/web/scripts/kairos-board-backfill.mjs           # all projects
//   node apps/web/scripts/kairos-board-backfill.mjs --dry-run # plan only
//   node apps/web/scripts/kairos-board-backfill.mjs --skip="AS Sprint,..."
//   node apps/web/scripts/kairos-board-backfill.mjs --concurrency=8
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').replace(/\r/g, '').split('\n')) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}

const BASE_URL = (process.env.AEON_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
const API_KEY = process.env.AEON_API_KEY
if (!API_KEY) {
  console.error('AEON_API_KEY missing from .env.local')
  process.exit(1)
}

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const SKIP = (() => {
  const arg = args.find((a) => a.startsWith('--skip='))
  if (!arg) return new Set()
  return new Set(arg.slice('--skip='.length).split(',').map((s) => s.trim().toLowerCase()))
})()
const CONCURRENCY = (() => {
  const arg = args.find((a) => a.startsWith('--concurrency='))
  return arg ? Math.max(1, parseInt(arg.slice('--concurrency='.length), 10)) : 6
})()

const TITLE_MAX = 200
const trunc = (s, n = TITLE_MAX) => (s.length <= n ? s : s.slice(0, n - 1) + '…')

async function api(path, init = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${API_KEY}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${init.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

async function listProjects() {
  const out = await api('/api/v1/projects?limit=500')
  return out?.data ?? out ?? []
}

async function listTasks(projectId) {
  const out = await api(`/api/v1/projects/${projectId}/tasks?limit=500`)
  return out?.data ?? out ?? []
}

function taskMemoryBody(task, projectName) {
  const lines = [
    `**Project:** ${projectName}`,
    `**Status:** ${task.status} | **Priority:** ${task.priority ?? 'medium'}`,
  ]
  if (task.startDate || task.endDate) {
    lines.push(`**Dates:** ${task.startDate ?? '—'} → ${task.endDate ?? '—'}`)
  }
  if (task.description && task.description.trim()) {
    lines.push('', task.description.trim())
  }
  lines.push('', `_Imported from Aeon board._`)
  return lines.join('\n')
}

function rollupBody(project, tasks) {
  const counts = { todo: 0, 'in-progress': 0, done: 0 }
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1
  const recentOpen = tasks
    .filter((t) => t.status !== 'done')
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 8)
    .map((t) => `- ${t.name} (${t.priority ?? 'medium'})`)
  const lines = [
    `**Project rollup snapshot.**`,
    '',
    `**Counts:** ${counts.todo} todo · ${counts['in-progress']} in-progress · ${counts.done} done · ${tasks.length} total`,
    `**Board age:** created ${project.createdAt?.slice(0, 10)}, last updated ${project.updatedAt?.slice(0, 10)}`,
    `**Description:** ${project.description ?? '—'}`,
  ]
  if (recentOpen.length) {
    lines.push('', '**Top open tasks (recent activity):**', ...recentOpen)
  }
  return lines.join('\n')
}

async function captureMemory(body) {
  if (DRY_RUN) return { dryRun: true }
  return api('/api/v1/memories/capture', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function projectSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function runWithConcurrency(items, worker, n) {
  const results = []
  let i = 0
  const next = async () => {
    while (i < items.length) {
      const idx = i++
      try {
        results[idx] = await worker(items[idx], idx)
      } catch (err) {
        results[idx] = { error: err.message }
      }
    }
  }
  await Promise.all(Array.from({ length: n }, () => next()))
  return results
}

async function main() {
  console.log(`kairos-board-backfill: ${DRY_RUN ? 'DRY RUN — ' : ''}target ${BASE_URL}  concurrency=${CONCURRENCY}`)
  if (SKIP.size) console.log(`  skipping: ${[...SKIP].join(', ')}`)

  const projects = await listProjects()
  console.log(`found ${projects.length} projects`)

  let totalTaskMems = 0
  let totalTaskExisting = 0
  let totalRollup = 0
  let totalRollupExisting = 0
  let totalErrors = 0

  for (const project of projects) {
    if (SKIP.has(project.name.toLowerCase())) {
      console.log(`\n[skip] ${project.name}`)
      continue
    }
    const tasks = await listTasks(project.id)
    if (tasks.length === 0) {
      console.log(`\n[empty] ${project.name}`)
      continue
    }
    console.log(`\n[${project.name}] ${tasks.length} tasks`)

    const slug = projectSlug(project.name)
    const taskResults = await runWithConcurrency(
      tasks,
      async (task) =>
        captureMemory({
          title: trunc(task.name || '(untitled task)'),
          bodyMd: taskMemoryBody(task, project.name),
          type: task.status === 'done' ? 'achievement' : 'fact',
          source: 'import',
          projectId: project.id,
          taskId: task.id,
          tags: ['board-backfill', slug, task.status],
          sourceMetadata: {
            externalId: `board-task:${task.id}`,
            kind: 'board_task_backfill',
            taskCreatedAt: task.createdAt,
            taskUpdatedAt: task.updatedAt,
          },
        }),
      CONCURRENCY,
    )

    for (const r of taskResults) {
      if (r?.error) totalErrors++
      else if (r?.dryRun) totalTaskMems++
      else if (r?.data?.created === false) totalTaskExisting++
      else totalTaskMems++
    }

    const rollup = await captureMemory({
      title: trunc(`Aeon board snapshot · ${project.name}`),
      bodyMd: rollupBody(project, tasks),
      type: 'snapshot',
      source: 'import',
      projectId: project.id,
      tags: ['board-backfill', slug, 'project-rollup'],
      sourceMetadata: {
        externalId: `project-rollup:${project.id}`,
        kind: 'project_rollup_backfill',
        taskCount: tasks.length,
      },
    })
    if (rollup?.error) totalErrors++
    else if (rollup?.dryRun) totalRollup++
    else if (rollup?.data?.created === false) totalRollupExisting++
    else totalRollup++

    const newCount = taskResults.filter((r) => !r?.error && !(r?.data?.created === false)).length
    const dupCount = taskResults.filter((r) => r?.data?.created === false).length
    console.log(`  ✓ ${newCount} new · ${dupCount} already existed${rollup?.data?.created === false ? '' : ' + rollup'}`)
  }

  console.log(`\n──────`)
  console.log(`Task memories: ${totalTaskMems} new · ${totalTaskExisting} already existed`)
  console.log(`Project rollups: ${totalRollup} new · ${totalRollupExisting} already existed`)
  console.log(`Errors: ${totalErrors}`)
  if (DRY_RUN) console.log(`(dry run — nothing written)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
