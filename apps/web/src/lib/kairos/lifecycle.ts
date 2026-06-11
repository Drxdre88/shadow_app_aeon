// ─────────────────────────────────────────────────────────────────────────
// Ephemeral-memory lifecycle — pure constants + helpers (no DB), unit-testable.
//
// Snapshots and advisories are machine-generated and short-lived: a snapshot
// only feeds the next morning's brief; an advisory only matters the day it's
// shown. Past their TTL they are pure bloat and get archived (stamped, never
// deleted) by the nightly lifecycle pass in project-snapshot.ts.
// ─────────────────────────────────────────────────────────────────────────

export const SNAPSHOT_TTL_DAYS = 7
export const ADVISORY_TTL_DAYS = 14

export function cutoffDate(now: Date, ttlDays: number): Date {
  return new Date(now.getTime() - ttlDays * 24 * 60 * 60 * 1000)
}
