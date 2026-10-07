import { esc, fmt, shortMonth } from './report-format.mjs'

export const COLORS = { accent: '#79a8d8', muted: '#5c6672', grid: '#2a2a2a', axis: '#8a8a8a', empty: '#222' }
const W = 860
const PAD = { left: 64, right: 16, top: 14, bottom: 34 }

export function niceMax(v) {
  if (!(v > 0)) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  for (const step of [1, 2, 2.5, 5, 10]) if (step * mag >= v) return step * mag
  return 10 * mag
}

export function compact(n) {
  const a = Math.abs(n)
  if (a >= 1e6) return `${+(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`
  if (a >= 1e3) return `${+(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`
  return fmt(n)
}

function svgOpen(height, label) {
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">`
}

function yAxis(height, max, tick) {
  const inner = height - PAD.top - PAD.bottom
  let out = ''
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4
    const y = PAD.top + inner - (inner * i) / 4
    out += `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${COLORS.grid}"/>`
    out += `<text x="${PAD.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="tick">${esc(tick(v))}</text>`
  }
  return out
}

function xLabels(labels, height, slot) {
  const every = labels.length > 16 ? Math.ceil(labels.length / 13) : 1
  return labels.map((l, i) => (i % every ? '' : `<text x="${(PAD.left + slot * (i + 0.5)).toFixed(1)}" y="${height - 12}" text-anchor="middle" class="tick">${esc(shortMonth(l))}</text>`)).join('')
}

function legend(series) {
  if (series.length < 2) return ''
  return `<p class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</p>`
}

export function barChart({ labels, series, label, height = 220, tick = compact, value = fmt }) {
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v || 0))))
  const inner = height - PAD.top - PAD.bottom
  const slot = (W - PAD.left - PAD.right) / labels.length
  const barW = Math.max(2, (slot * 0.72) / series.length)
  let bars = ''
  labels.forEach((l, i) => {
    series.forEach((s, j) => {
      const v = s.values[i] || 0
      const h = (inner * v) / max
      const x = PAD.left + slot * i + slot * 0.14 + barW * j
      const y = PAD.top + inner - h
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 1).toFixed(1)}" height="${Math.max(h, v ? 1 : 0).toFixed(1)}" fill="${s.color}"><title>${esc(`${shortMonth(l)} · ${s.name}: ${value(v)}`)}</title></rect>`
    })
  })
  return `<figure>${svgOpen(height, label)}${yAxis(height, max, tick)}${bars}${xLabels(labels, height, slot)}</svg>${legend(series)}</figure>`
}

export function lineChart({ labels, series, label, height = 220, max = null, tick = compact, value = fmt }) {
  const top = max ?? niceMax(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v || 0))))
  const inner = height - PAD.top - PAD.bottom
  const slot = (W - PAD.left - PAD.right) / labels.length
  let body = ''
  for (const s of series) {
    const pts = s.values.map((v, i) => (v == null ? null : [PAD.left + slot * (i + 0.5), PAD.top + inner - (inner * v) / top]))
    let path = ''
    pts.forEach((p, i) => {
      if (!p) return
      path += `${path && pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)} `
    })
    body += `<path d="${path.trim()}" fill="none" stroke="${s.color}" stroke-width="2"/>`
    pts.forEach((p, i) => {
      if (p) body += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" fill="${s.color}"><title>${esc(`${shortMonth(labels[i])} · ${s.name}: ${value(s.values[i])}`)}</title></circle>`
    })
  }
  return `<figure>${svgOpen(height, label)}${yAxis(height, top, tick)}${body}${xLabels(labels, height, slot)}</svg>${legend(series)}</figure>`
}

function shade(v, max) {
  if (!v) return COLORS.empty
  const t = 0.25 + 0.75 * Math.sqrt(v / max)
  return `rgba(121,168,216,${t.toFixed(2)})`
}

export function heatStrip(weeks, { label = 'Commits per week' } = {}) {
  const size = 13
  const gap = 3
  const perRow = Math.ceil(weeks.length / Math.max(1, Math.ceil(weeks.length / 53)))
  const rows = Math.ceil(weeks.length / perRow)
  const max = Math.max(1, ...weeks.map((w) => w.commits))
  const width = perRow * (size + gap)
  const height = rows * (size + gap) + 18
  let cells = ''
  let lastMonth = ''
  weeks.forEach((w, i) => {
    const x = (i % perRow) * (size + gap)
    const y = Math.floor(i / perRow) * (size + gap)
    cells += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2" fill="${shade(w.commits, max)}"><title>${esc(`Week of ${w.start} (${w.week}): ${fmt(w.commits)} commits`)}</title></rect>`
    const month = w.start.slice(0, 7)
    if (month !== lastMonth && i % perRow < perRow - 2) {
      cells += `<text x="${x}" y="${rows * (size + gap) + 12}" class="tick">${esc(shortMonth(month).split(' ')[0])}</text>`
      lastMonth = month
    }
  })
  return `<figure class="strip"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">${cells}</svg></figure>`
}

export function timeline(rows, months, { label = 'Active months per repository' } = {}) {
  const nameW = 170
  const cell = Math.min(48, (W - nameW) / months.length)
  const rowH = 20
  const height = rows.length * rowH + 26
  const max = Math.max(1, ...rows.flatMap((r) => months.map((m) => r.months.get(m) || 0)))
  let out = ''
  rows.forEach((r, i) => {
    const y = i * rowH
    out += `<text x="${nameW - 8}" y="${y + 14}" text-anchor="end" class="tick">${esc(r.repo)}</text>`
    months.forEach((m, j) => {
      const v = r.months.get(m) || 0
      out += `<rect x="${(nameW + j * cell).toFixed(1)}" y="${y + 3}" width="${(cell - 3).toFixed(1)}" height="${rowH - 6}" rx="2" fill="${shade(v, max)}"><title>${esc(`${r.repo} · ${shortMonth(m)}: ${fmt(v)} commits`)}</title></rect>`
    })
  })
  months.forEach((m, j) => {
    out += `<text x="${(nameW + j * cell + (cell - 3) / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle" class="tick">${esc(shortMonth(m).split(' ')[0])}</text>`
  })
  return `<figure>${svgOpen(height, label)}${out}</svg></figure>`
}
