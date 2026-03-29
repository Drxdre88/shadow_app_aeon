'use client'

import { format } from 'date-fns'

interface SnapshotData {
  projectName: string
  snapshot: {
    columns: { id: string; name: string; color: string; icon: string | null; orderIndex: number }[]
    tasks: { id: string; name: string; description: string | null; columnId: string | null; status: string; priority: string; color: string; orderIndex: number; labels: string[] }[]
    labels: { id: string; name: string; color: string }[]
    createdAt: string
  }
  createdAt: Date
  expiresAt: Date
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#3b82f6',
  low: '#64748b',
}

export function SharedBoardView({ data }: { data: SnapshotData }) {
  const { snapshot, projectName, createdAt, expiresAt } = data
  const sortedColumns = [...snapshot.columns].sort((a, b) => a.orderIndex - b.orderIndex)
  const labelMap = Object.fromEntries(snapshot.labels.map((l) => [l.id, l]))

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <header className="sticky top-0 z-10 backdrop-blur-xl bg-[#0a0a0f]/80 border-b border-white/10 px-6 py-4">
        <div className="flex items-center justify-between max-w-[1800px] mx-auto">
          <div>
            <h1 className="text-lg font-bold">{projectName}</h1>
            <p className="text-xs text-slate-500">
              Snapshot from {format(new Date(createdAt), 'dd MMM yyyy, HH:mm')}
              {' — '}expires {format(new Date(expiresAt), 'dd MMM yyyy')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600 px-3 py-1 rounded-full border border-white/10 bg-white/5">
              Read-only snapshot
            </span>
            <span className="text-xs font-medium px-3 py-1 rounded-full" style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}>
              AEON
            </span>
          </div>
        </div>
      </header>

      <main className="overflow-x-auto px-6 py-6">
        <div className="flex gap-4 min-w-min max-w-[1800px] mx-auto">
          {sortedColumns.map((col) => {
            const colTasks = snapshot.tasks
              .filter((t) => t.columnId === col.id)
              .sort((a, b) => a.orderIndex - b.orderIndex)

            return (
              <div key={col.id} className="flex-shrink-0 w-[300px]">
                <div className="flex items-center gap-2 mb-3 px-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.color }} />
                  <span className="text-sm font-semibold text-slate-200">{col.name}</span>
                  <span className="text-xs text-slate-600 ml-1">{colTasks.length}</span>
                </div>

                <div className="space-y-2">
                  {colTasks.map((task) => (
                    <div
                      key={task.id}
                      className="p-3 rounded-xl border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.06] transition-colors"
                    >
                      <div className="flex items-start gap-2 mb-1.5">
                        <div
                          className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                          style={{ backgroundColor: PRIORITY_COLORS[task.priority] ?? '#64748b' }}
                        />
                        <span className="text-sm font-medium text-slate-200 leading-snug">{task.name}</span>
                      </div>

                      {task.description && (
                        <p className="text-xs text-slate-500 line-clamp-2 pl-4 mb-2">{task.description}</p>
                      )}

                      {task.labels.length > 0 && (
                        <div className="flex flex-wrap gap-1 pl-4">
                          {task.labels.map((labelId) => {
                            const label = labelMap[labelId]
                            if (!label) return null
                            return (
                              <span
                                key={labelId}
                                className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                style={{
                                  backgroundColor: `${label.color}20`,
                                  color: label.color,
                                  border: `1px solid ${label.color}30`,
                                }}
                              >
                                {label.name}
                              </span>
                            )
                          })}
                        </div>
                      )}

                      <div className="flex items-center gap-2 mt-2 pl-4">
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                          style={{
                            backgroundColor: `${PRIORITY_COLORS[task.priority] ?? '#64748b'}20`,
                            color: PRIORITY_COLORS[task.priority] ?? '#64748b',
                          }}
                        >
                          {task.priority}
                        </span>
                      </div>
                    </div>
                  ))}

                  {colTasks.length === 0 && (
                    <div className="px-3 py-6 text-center text-xs text-slate-700">No tasks</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
