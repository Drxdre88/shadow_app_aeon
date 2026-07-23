// Decoders for raw sql`` fragments. A bare sql<Date> generic is a type
// assertion only — aggregate fragments like MAX(timestamp) bypass the
// column's driver mapping and arrive as strings (2026-07-23 ask-mine
// outage: `.getTime is not a function`). Pass this to .mapWith() on any
// raw timestamp fragment.
export function decodeDateOrNull(value: string | Date | null): Date | null {
  return value == null ? null : new Date(value)
}
