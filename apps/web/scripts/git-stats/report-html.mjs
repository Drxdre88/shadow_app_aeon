import { COLORS, barChart, heatStrip, lineChart, timeline } from './report-charts.mjs'
import { esc } from './report-format.mjs'

const CSS = `
:root { color-scheme: dark; }
body { margin: 0; background: #161616; color: #d8d8d8; font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 900px; margin: 0 auto; padding: 48px 24px 96px; }
h1 { font-size: 28px; font-weight: 600; margin: 0 0 4px; color: #eee; }
h2 { font-size: 20px; font-weight: 600; margin: 56px 0 16px; padding-top: 24px; border-top: 1px solid #2a2a2a; color: #eee; }
h3 { font-size: 15px; font-weight: 600; margin: 32px 0 8px; color: #c8c8c8; }
p, li { margin: 0 0 10px; }
.sub, .note, .legend, figcaption { color: #8f8f8f; font-size: 14px; }
.answer { padding-left: 20px; }
.answer li { margin-bottom: 8px; }
.answer li::marker { color: ${COLORS.accent}; }
figure { margin: 8px 0 20px; }
svg { width: 100%; height: auto; display: block; }
.strip svg { max-width: 860px; }
.tick { fill: #8a8a8a; font-size: 11px; font-family: inherit; }
.legend span { margin-right: 18px; white-space: nowrap; }
.legend i { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 2px; vertical-align: baseline; }
.table { overflow-x: auto; margin: 8px 0 24px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; font-variant-numeric: tabular-nums; }
th, td { padding: 6px 10px; border-bottom: 1px solid #262626; vertical-align: top; }
th { color: #9a9a9a; font-weight: 500; text-align: left; }
.r { text-align: right; white-space: nowrap; }
a { color: ${COLORS.accent}; }
`

export function tableHtml({ head, align, rows }) {
  if (!rows.length) return '<p class="note">Nothing to show.</p>'
  const cls = (i) => (align[i] === 'r' ? ' class="r"' : '')
  const th = head.map((h, i) => `<th${cls(i)}>${esc(h)}</th>`).join('')
  const body = rows.map((r) => `<tr>${r.map((v, i) => `<td${cls(i)}>${esc(v)}</td>`).join('')}</tr>`).join('\n')
  return `<div class="table"><table><thead><tr>${th}</tr></thead><tbody>\n${body}\n</tbody></table></div>`
}

const pctValue = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`)

function charts(model) {
  const labels = model.months
  const s = model.series
  const col = (key) => s.map((m) => m[key])
  const all = { color: COLORS.muted }
  const code = { color: COLORS.accent }
  return [
    ['Commits per month', barChart({ labels, label: 'Commits per month', series: [{ name: 'Commits', values: col('commits'), ...code }] })],
    ['Lines added per month (authored)', barChart({ labels, label: 'Lines added per month', series: [{ name: 'All files', values: col('added'), ...all }, { name: 'Code only', values: col('codeAdded'), ...code }] })],
    ['Lines removed per month (authored)', barChart({ labels, label: 'Lines removed per month', series: [{ name: 'All files', values: col('removed'), ...all }, { name: 'Code only', values: col('codeRemoved'), ...code }] })],
    ['Cumulative lines added', lineChart({ labels, label: 'Cumulative lines added', series: [{ name: 'All files', values: col('cumAdded'), ...all }, { name: 'Code only', values: col('cumCode'), ...code }] })],
    ['Pull requests per month', barChart({ labels, label: 'Pull requests per month', series: [{ name: 'Opened', values: col('prsOpened'), ...all }, { name: 'Merged', values: col('prsMerged'), ...code }] })],
    ['Active days per month', barChart({ labels, label: 'Active days per month', series: [{ name: 'Active days', values: col('activeDays'), ...code }] })],
    ['AI-assisted share of commits', lineChart({ labels, label: 'AI-assisted share per month', max: 1, tick: pctValue, value: pctValue, series: [{ name: 'AI-assisted', values: col('aiShare'), ...code }] })],
  ]
}

export function renderHtml(model, sec) {
  const partial = model.partialMonths.length ? ` Months marked "part" are only partly inside the window.` : ''
  const chartBlocks = charts(model).map(([title, svg]) => `<h3>${esc(title)}</h3>\n${svg}`).join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(sec.title)} · ${esc(sec.subtitle)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${esc(sec.title)}</h1>
<p class="sub">${esc(sec.subtitle)} · generated from git history and pull request data</p>

<h2>The short answer</h2>
<ul class="answer">
${sec.headlines.map((l) => `<li>${esc(l)}</li>`).join('\n')}
</ul>
<p class="note">${esc(sec.counting)}</p>

<h2>How the year unfolded</h2>
<p class="note">Hover over any bar or point for its exact value. All line figures are authored lines; set-aside imports and dumps are not included.${esc(partial)}</p>
${chartBlocks}
<h3>Week by week</h3>
<p class="note">One square per week; brighter means more commits.</p>
${heatStrip(model.weeks)}
<h3>Month by month</h3>
${tableHtml(sec.months)}

<h2>By repository</h2>
<p class="note">Sorted by code lines changed. Lines are authored lines; set-aside commits are not included.</p>
${tableHtml(sec.repos)}
<h3>When each repository was active</h3>
${timeline(model.repos.filter((r) => r.tally.commits), model.months)}
<h3>Active period and main directories</h3>
${tableHtml(sec.repoDetail)}

<h2>Where you started</h2>
<p>${esc(sec.baselineSummary)}</p>
${tableHtml(sec.baseline)}

<h2>What stands out</h2>
<ol>
${sec.findings.map((f) => `<li>${esc(f)}</li>`).join('\n')}
</ol>

<h2>What was set aside</h2>
<p class="note">Commits kept out of line and file totals (they still count as commits), largest first. Lines are authored lines.</p>
${tableHtml(sec.excluded)}
<h3>Lines in excluded folders, per repository</h3>
<p class="note">Your counted commits only. The last column includes the excluded folders plus lockfiles, generated files and data anywhere in the repository.</p>
${tableHtml(sec.excludedPaths)}
<p class="note">${esc(sec.others)}</p>

<h2>Method and caveats</h2>
<ul>
${sec.method.map((m) => `<li>${esc(m)}</li>`).join('\n')}
</ul>
</main>
</body>
</html>
`
}
