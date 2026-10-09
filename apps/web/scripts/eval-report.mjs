// Markdown rendering for the retrieval eval report.
import { CATEGORIES } from './eval-metrics.mjs'

const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`)
const num = (v) => (v === null || v === undefined ? '—' : v.toFixed(2))

function abstainCell(o) {
  if (!o.abstainN) return '—'
  const r = o.abstainByRule
  const rules = r ? ` (empty ${r.empty}, lowConf ${r.lowConfidence})` : ''
  return `${pct(o.abstainPass)} of ${o.abstainN}${rules}`
}

const viaCell = (v) => (v ? `${v.link} / ${v.signpost}` : '—')

function overallTable(paths) {
  const lines = [
    '| Path | n | recall@5 | recall@10 | MRR | hit@1 | hit@5 | hit@10 | stale-above (KU) | lowConf on answerable | relevant via link / signpost (top 10) | abstention pass | errors |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const p of paths) {
    const o = p.overall
    lines.push(
      `| ${p.path} | ${o.n} | ${pct(o.recall5)} | ${pct(o.recall10)} | ${num(o.mrr)} | ${pct(o.hit1)} | ${pct(o.hit5)} | ${pct(o.hit10)} | ${pct(o.staleAbove)} | ${pct(o.lowConfidenceAnswerable)} | ${viaCell(o.relevantVia)} | ${abstainCell(o)} | ${o.errors} |`,
    )
  }
  return lines.join('\n')
}

function categoryTable(paths) {
  const lines = [
    '| Category | Path | n | recall@5 | recall@10 | MRR | hit@1 | hit@5 | hit@10 | via link / signpost |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const c of CATEGORIES.filter((x) => x !== 'abstention')) {
    for (const p of paths) {
      const a = p.byCategory[c]
      if (!a) continue
      lines.push(`| ${c} | ${p.path} | ${a.n} | ${pct(a.recall5)} | ${pct(a.recall10)} | ${num(a.mrr)} | ${pct(a.hit1)} | ${pct(a.hit5)} | ${pct(a.hit10)} | ${viaCell(a.relevantVia)} |`)
    }
  }
  for (const p of paths) {
    const a = p.byCategory.abstention
    if (a) lines.push(`| abstention | ${p.path} | ${a.abstainN} | pass ${abstainCell(a)} | | | | | | |`)
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
      if (r.score.abstain !== undefined) {
        if (!r.score.abstain) return `answered (${r.score.falseHits} hits) ✗`
        return r.score.abstainRule === 'lowConfidence' ? 'abstained ✓ (lowConf)' : 'abstained ✓'
      }
      const v = r.score.via
      const tag = v && (v.link || v.signpost) ? ` [via link ${v.link}, signpost ${v.signpost}]` : ''
      return `${r.score.firstRank ?? 'miss'} / ${pct(r.score.recall10)}${r.score.stale ? ' ⚠ stale-first' : ''}${tag}`
    })
    lines.push(`| ${f.id} | ${f.category} | ${f.query} | ${cells.join(' | ')} |`)
  }
  return lines.join('\n')
}

export function renderMarkdown(report, fixtures) {
  const c = report.config
  const expand = c.expand === true ? 'on' : c.expand === false ? 'off' : 'not sent'
  return [
    `# Retrieval eval — ${c.started.slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `Server: ${c.baseUrl} · questions: ${c.questions} · HTTP calls: ${c.calls} · context budget ${c.budget} / maxSources ${c.maxSources} · expand: ${expand}`,
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
