'use server'

import { requireMemberAccess } from './helpers'
import { solveProjectSchedule, type ProjectSchedule } from '@/lib/schedule/solve-project'

export type { ProjectSchedule, ScheduleLane } from '@/lib/schedule/solve-project'

/**
 * Solve-on-read (CHR-52). Called when a scheduler view opens, never on board
 * load: it derives lanes from the project's people, guarantees a calendar, runs
 * the solver from `now`, persists computed_* as the cache and returns the plan.
 * Any member may read the schedule. The derived rows — the default calendar,
 * one resource per person, the computed_* cache — are written only for editors;
 * a viewer gets the same plan solved in memory over unsaved stand-ins.
 */
export async function solveProject(projectId: string): Promise<ProjectSchedule> {
  const { role } = await requireMemberAccess(projectId)
  return solveProjectSchedule(projectId, { canWrite: role !== 'viewer', now: new Date() })
}