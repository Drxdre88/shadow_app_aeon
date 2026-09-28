// Client-safe: no DB imports, so the stats modal can share the server's numbers.
export const STORAGE_LIMITS = {
  tasks: 2000,
  canvasNodes: 200,
  ganttTasks: 200,
} as const
