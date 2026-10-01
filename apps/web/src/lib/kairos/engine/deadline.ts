import type { EngineRunContext } from './types'

// True once the run's wall-clock budget is spent. Steps check it before each
// new mutation: a function the platform kills mid-await never writes its cron
// trace, so the engine must stop on its own first (2026-10-01 incident).
export function outOfTime(ctx: Pick<EngineRunContext, 'deadline'>, now: number = Date.now()): boolean {
  return ctx.deadline !== undefined && now >= ctx.deadline
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
