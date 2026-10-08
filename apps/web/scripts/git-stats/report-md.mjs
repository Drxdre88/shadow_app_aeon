import { fmt, mdCell, shortMonth } from './report-format.mjs'

export function tableMd({ head, align, rows }) {
  if (!rows.length) return '_Nothing to show._\n'
  const sep = align.map((a) => (a === 'r' ? '---:' : '---'))
  const line = (cells) => `| ${cells.map(mdCell).join(' | ')} |`
  return [line(head), `|${sep.join('|')}|`, ...rows.map(line)].join('\n') + '\n'
}

function weekTable(weeks) {
  const byMonth = new Map()
  for (const w of weeks) {
    const m = w.start.slice(0, 7)
    if (!byMonth.has(m)) byMonth.set(m, [])
    byMonth.get(m).push(w.commits)
  }
  return tableMd({
    head: ['Month', 'Commits per week (in order)'],
    align: ['l', 'l'],
    rows: [...byMonth].map(([m, v]) => [shortMonth(m), v.map(fmt).join(' · ')]),
  })
}

function timelineTable(model) {
  const repos = model.repos.filter((r) => r.tally.commits)
  return tableMd({
    head: ['Repository', ...model.months.map(shortMonth)],
    align: ['l', ...model.months.map(() => 'r')],
    rows: repos.map((r) => [r.repo, ...model.months.map((m) => (r.months.get(m) ? fmt(r.months.get(m)) : ''))]),
  })
}

export function renderMarkdown(model, sec) {
  return `# ${sec.title}

${sec.subtitle}

## The short answer

${sec.headlines.map((l) => `- ${l}`).join('\n')}

${sec.counting}

## Scale of the AI operation

${sec.aiLines.map((l) => `- ${l}`).join('\n')}

${sec.aiPolicy}

${sec.eraTable.rows.length ? `### Before and after the agent era\n\n${tableMd(sec.eraTable)}\n` : ''}### You vs AI by month

${tableMd(sec.aiMonths)}
## How the year unfolded

Month-by-month figures (the HTML report charts these: code and authored lines added and removed, cumulative lines, commits, PRs opened vs merged, active days). Authored lines are code, tests, docs and config.${model.partialMonths.length ? ' "(part)" months are only partly inside the window.' : ''}

${tableMd(sec.months)}
### Week by week

${weekTable(model.weeks)}
## By repository

Sorted by code lines changed.

${tableMd(sec.repos)}
### Active period and main directories

${tableMd(sec.repoDetail)}
### Commits per repository per month

${timelineTable(model)}
## Where you started

${sec.baselineSummary}

${tableMd(sec.baseline)}
## What stands out

${sec.findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}

## Biggest single drops

The largest commits of the year by lines changed. All of them are counted; the kind and label are for information only.

${tableMd(sec.drops)}
${sec.others}

## Method and caveats

${sec.method.map((m) => `- ${m}`).join('\n')}
${sec.folders.rows.length ? `\n### Lines counted only in the raw figure, per repository\n\n${tableMd(sec.folders)}` : ''}`
}
