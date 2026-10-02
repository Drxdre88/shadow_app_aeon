const pad = (n: number) => String(n).padStart(2, '0')

export function localDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

export function localClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function relativeTo(iso: string, nowIso: string): string {
  const mins = Math.round((Date.parse(nowIso) - Date.parse(iso)) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 36) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

function expandHours(field: string): number[] | null {
  const hours: number[] = []
  for (const part of field.split(',')) {
    const range = part.match(/^(\d{1,2})-(\d{1,2})$/)
    if (range) {
      for (let h = Number(range[1]); h <= Number(range[2]); h++) hours.push(h)
    } else if (/^\d{1,2}$/.test(part)) {
      hours.push(Number(part))
    } else {
      return null
    }
  }
  return hours.length ? hours : null
}

export function cronToLocal(cronUtc: string, refIso: string): string | null {
  const [minute, hour] = cronUtc.trim().split(/\s+/)
  if (!/^\d{1,2}$/.test(minute ?? '')) return null
  const hours = expandHours(hour ?? '')
  if (!hours) return null
  const ref = new Date(refIso)
  const toLocal = (h: number) => {
    const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), h, Number(minute)))
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const first = toLocal(hours[0])
  if (hours.length === 1) return `${first} your time, daily`
  return `Hourly ${first}–${toLocal(hours[hours.length - 1])} your time`
}
