// Markdown rendering for the retrieval eval report.
import { CATEGORIES } from './eval-metrics.mjs'

const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`)
const num = (v) => (v === null || v === undefined ? '—' : v.toFixed(2))

function overallTable(paths) {
  const lines = [
    '| Path | n | recall@5 | recall@10 | MRR | hit@1 | hit@5 | hit@10 | stale-above (KU) | abstention pass | errors |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const p of paths) {
    const o = p.overall
    lines.push(
      `| ${p.path} | ${o.n} | ${pct(o.recall5)} | ${pct(o.recall10)} | ${num(o.mrr)} | ${pct(o.hit1)} | ${pct(o.hit5)} | ${pct(o.hit10)} | ${pct(o.staleAbove)} | ${o.abstainN ? `${pct(o.abstainPass)} of ${o.abstainN}` : '—'} | ${o.errors} |`,
    )
  }
  return lines.join('\n')
}

function categoryTable(paths) {
  const lines = ['| Category | Path | n | recall@5 | recall@10 | MRR | hit@1 | hit@5 | hit@10 |', '|---|---|---|---|---|---|---|---|---|']
  for (const c of CATEGORIES.filter((x) => x !== 'abstention')) {
    for (const p of paths) {
      const a = p.byCategory[c]
      if (!a) continue
      lines.push(`| ${c} | ${p.path} | ${a.n} | ${pct(a.recall5)} | ${pct(a.recall10)} | ${num(a.mrr)} | ${pct(a.hit1)} | ${pct(a.hit5)} | ${pct(a.hit10)} |`)
    }
  }
  for (const p of paths) {
    const a = p.byCategory.abstention
    if (a) lines.push(`| abstention | ${p.path} | ${a.abstainN} | pass ${pct(a.abstainPass)} | | | | | |`)
  }
  return lines.join('\n')
}

function questionTable(paths, fixtures) {
  const head = `| id | category | question | ${paths.map((p) => `${p.path} first rank / R@10`).join(' | ')} |`
  const lines = [head, `|${'---|'.repeat(3 + paths.length)}`]
  for (const f of fixtures) {
    const cells = paths.map((p) => {
      const r = p.rows.find((x) => x.id === f.id)
      if (!r || r.error) return 'error'
      if (r.score.abstain !== undefined) return r.score.abstain ? 'abstained ✓' : `answered (${r.score.falseHits} hits) ✗`
      return `${r.score.firstRank ?? 'miss'} / ${pct(r.score.recall10)}${r.score.stale ? ' ⚠ stale-first' : ''}`
    })
    lines.push(`| ${f.id} | ${f.category} | ${f.query} | ${cells.join(' | ')} |`)
  }
  return lines.join('\n')
}

export function renderMarkdown(report, fixtures) {
  const c = report.config
  return [
    `# Retrieval eval — ${c.started.slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `Server: ${c.baseUrl} · questions: ${c.questions} · HTTP calls: ${c.calls} · context budget ${c.budget} / maxSources ${c.maxSources}`,
    '',
    `Pinned memories (always injected by context): ${c.pinnedCount ?? '—'}; relevant ids that are pinned: ${c.relevantPinned?.length ?? 0}${c.relevantPinned?.length ? ` (${c.relevantPinned.map((id) => id.slice(0, 8)).join(', ')})` : ''}`,
    '',
    '## Overall (answerable questions; abstention separate)',
    '',
    overallTable(report.paths),
    '',
    '## By category',
    '',
    categoryTable(report.paths),
    '',
    '## Per question',
    '',
    questionTable(report.paths, fixtures),
  ].join('\n')
}
