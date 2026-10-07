const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const NUMBER = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

export function fmt(n) {
  return n == null || Number.isNaN(n) ? '–' : NUMBER.format(Math.round(n))
}

export function pct(part, whole, digits = 0) {
  if (!whole) return '–'
  return `${((100 * part) / whole).toFixed(digits)}%`
}

export function share(part, whole) {
  return whole ? part / whole : 0
}

export function signed(added, removed) {
  return `+${fmt(added)} / −${fmt(removed)}`
}

export function monthLabel(month, { year = true } = {}) {
  const [y, m] = month.split('-').map(Number)
  return year ? `${MONTH_NAMES[m - 1]} ${y}` : MONTH_NAMES[m - 1]
}

export function shortMonth(month) {
  const [y, m] = month.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${String(y).slice(2)}`
}

export function dayLabel(day) {
  if (!day) return '–'
  const [y, m, d] = day.split('-').map(Number)
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`
}

export function hours(h) {
  if (h == null) return '–'
  if (h < 1 / 60) return 'under a minute'
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) return `${h.toFixed(1)} h`
  return `${(h / 24).toFixed(1)} days`
}

export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
}

export function mdCell(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export function listJoin(items) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
