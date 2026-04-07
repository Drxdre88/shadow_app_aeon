import { getPusher, boardChannel } from '@/lib/pusher'

export type BoardEvent =
  | { type: 'task:created' | 'task:updated' | 'task:deleted' | 'task:moved' }
  | { type: 'column:reordered' | 'column:created' | 'column:deleted' | 'column:updated' }
  | { type: 'label:changed' }
  | { type: 'dependency:changed' }
  | { type: 'checklist:changed' }
  | { type: 'comment:changed' }

export async function publishBoardEvent(projectId: string, event: BoardEvent): Promise<void> {
  const pusher = getPusher()
  if (!pusher) return

  try {
    await pusher.trigger(boardChannel(projectId), 'board-update', { type: event.type })
  } catch (err) {
    console.error('Pusher trigger failed:', err)
  }
}
