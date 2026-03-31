export type BoardEvent =
  | { type: 'task:created' | 'task:updated' | 'task:deleted' | 'task:moved' }
  | { type: 'column:reordered' | 'column:created' | 'column:deleted' }
  | { type: 'label:changed' }
  | { type: 'dependency:changed' }
  | { type: 'checklist:changed' }
  | { type: 'comment:changed' }

export async function publishBoardEvent(_projectId: string, _event: BoardEvent): Promise<void> {
}
