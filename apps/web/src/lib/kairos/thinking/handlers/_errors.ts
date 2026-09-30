import { ZodError } from 'zod'

// Short, actionable failure text for a job's `error` column and the routine's
// one-line report: the first few zod issues with their paths, else the message.
export function errorReason(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
      .slice(0, 500)
  }
  return (err instanceof Error ? err.message : String(err)).slice(0, 500)
}
