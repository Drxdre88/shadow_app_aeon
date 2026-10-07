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

## How the year unfolded

Month-by-month figures (the HTML report charts these: commits, authored lines added and removed for code vs all files, cumulative lines, PRs opened vs merged, active days, AI-assisted share).${model.partialMonths.length ? ' "(part)" months are only partly inside the window.' : ''}

${tableMd(sec.months)}
### Week by week

${weekTable(model.weeks)}
## By repository

Sorted by code lines changed; lines are authored lines; set-aside commits are not included.

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

## What was set aside

Commits kept out of line and file totals (they still count as commits), largest first. Lines are authored lines.

${tableMd(sec.excluded)}
### Lines in excluded folders, per repository

Your counted commits only. The last column includes the excluded folders plus lockfiles, generated files and data anywhere in the repository.

${tableMd(sec.excludedPaths)}
${sec.others}

## Method and caveats

${sec.method.map((m) => `- ${m}`).join('\n')}
`
}
