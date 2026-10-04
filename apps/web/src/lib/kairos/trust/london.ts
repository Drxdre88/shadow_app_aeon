// London calendar helpers for trust (Monday tail line, once-per-day footer).

const londonParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
})

export function londonDay(at: Date): { date: string; weekday: string } {
  const p: Record<string, string> = {}
  for (const part of londonParts.formatToParts(at)) p[part.type] = part.value
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday }
}

export const isLondonMonday = (at: Date): boolean => londonDay(at).weekday === 'Mon'
