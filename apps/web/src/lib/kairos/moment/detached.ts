import { after } from 'next/server'

// Starts a best-effort hook now and keeps the function alive with after(); a
// throw is swallowed (runners already log), outside a request it just completes.
export function runDetached(task: () => Promise<void>): void {
  const pending = task().catch(() => undefined)
  try {
    after(() => pending)
  } catch {
    // outside a request scope: the detached promise still completes
  }
}
