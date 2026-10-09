#!/usr/bin/env node
// Read-only discovery probe for labelling eval fixtures (GET only; never prints the API key).
// Usage:
//   node scripts/eval-probe.mjs search "<query>" [limit]
//   node scripts/eval-probe.mjs context "<query>"
//   node scripts/eval-probe.mjs get <memoryId> [bodyChars]
//   node scripts/eval-probe.mjs list [limit] [offset]
//   node scripts/eval-probe.mjs verify            # fetch every relevantId/mustNotId; DEAD/MISS = problem, MACH = warning
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { ReadOnlyClient, resolveConfig } from './eval-http.mjs'

const [cmd, a1, a2] = process.argv.slice(2)
const cfg = resolveConfig()
if (!cfg.apiKey) {
  process.stderr.write('AEON_API_KEY missing (env or apps/web/.env.local)\n')
  process.exit(1)
}
const client = new ReadOnlyClient({ ...cfg, delayMs: 350 })
const day = (d) => String(d ?? '').slice(0, 10)
const out = (s) => process.stdout.write(s + '\n')
const MACHINE_STREAMS = new Set(['trace', 'snapshot', 'delta', 'archetype', 'cortex', 'aether', 'advisory'])

if (cmd === 'search') {
  const data = await client.get('/api/v1/memories/search', { q: a1, limit: Number(a2 ?? 15) })
  out(`total=${data.total}`)
  for (const h of data.hits ?? []) out(`${h.id} ${day(h.createdAt)} [${h.type}] ${h.title}`)
} else if (cmd === 'context') {
  const { results, retrieval } = await client.context(a1, { maxSources: 15 })
  out(`retrieval=${JSON.stringify(retrieval)}`)
  for (const s of results) out(`${s.id} ${s.section} ${s.via} ${s.score} ${s.title}`)
} else if (cmd === 'get') {
  const m = await client.memory(a1)
  out(`${m.id} ${day(m.createdAt)} [${m.type}/${m.streamClass}/${m.source}] superseded=${m.supersededAt ?? '-'} archived=${m.archivedAt ?? '-'}`)
  out(`TITLE: ${m.title}`)
  out(`SUMMARY: ${m.summary ?? ''}`)
  if (m.links?.length) out(`LINKS: ${m.links.map((l) => `${l.type}:${l.target}`).join(' ')}`)
  out(String(m.bodyMd ?? '').slice(0, Number(a2 ?? 600)))
} else if (cmd === 'list') {
  const data = await client.get('/api/v1/memories', { limit: Number(a1 ?? 50), offset: Number(a2 ?? 0) })
  const rows = Array.isArray(data) ? data : data.memories ?? data.items ?? []
  for (const m of rows) out(`${m.id} ${day(m.createdAt)} [${m.type}] ${m.title}`)
} else if (cmd === 'verify') {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), '../eval/retrieval-fixtures.json')
  const { fixtures } = JSON.parse(readFileSync(path, 'utf8'))
  let bad = 0
  let machine = 0
  for (const f of fixtures) {
    for (const id of [...(f.relevantIds ?? []), ...(f.mustNotIds ?? [])]) {
      try {
        const m = await client.memory(id)
        const dead = m.archivedAt || m.supersededAt
        const isRelevant = (f.relevantIds ?? []).includes(id)
        if (dead && isRelevant) bad++
        // Machine rows are hidden from default retrieval, so an answer label on one can never be found.
        const isMachine = MACHINE_STREAMS.has(m.streamClass)
        if (isMachine && isRelevant) machine++
        out(`${f.id} ${dead ? 'DEAD' : isMachine && isRelevant ? 'MACH' : 'ok  '} ${id} ${m.title}`)
      } catch (err) {
        bad++
        out(`${f.id} MISS ${id} ${err.message}`)
      }
    }
  }
  out(`problems=${bad} machine-row answer labels (warning)=${machine}`)
  process.exit(bad ? 1 : 0)
} else {
  out('commands: search|context|get|list|verify — see header')
}
