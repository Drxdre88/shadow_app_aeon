import type { BoardTask } from '@/lib/store/boardStore'

export interface CardContentsItem {
  title: string
  groupName: string
  state?: string | null
  completed?: boolean
}

export interface CardContentsGroup {
  name: string
  items: string[]
}

export interface CardContents {
  title: string
  description: string
  groups: CardContentsGroup[]
  labels: string[]
  priority: string
}

export function buildCardContents(
  task: BoardTask,
  items: CardContentsItem[],
  labels: { id: string; name: string }[],
  priorityName: string,
): CardContents {
  const groups: CardContentsGroup[] = []
  for (const item of items) {
    const name = item.groupName || 'Checklist'
    let group = groups.find((entry) => entry.name === name)
    if (!group) {
      group = { name, items: [] }
      groups.push(group)
    }
    const state = item.state ?? (item.completed ? 'checked' : 'unchecked')
    const suffix = state === 'checked' ? ' (Done)' : state === 'crossed' ? ' (Not doing)' : ''
    group.items.push(`${item.title}${suffix}`)
  }

  return {
    title: task.name,
    description: task.description ?? '',
    groups,
    labels: task.labels.map((id) => labels.find((label) => label.id === id)?.name ?? id),
    priority: priorityName,
  }
}

export function cardContentsText(contents: CardContents): string {
  const checklist = contents.groups.flatMap((group) => [group.name, ...group.items.map((item) => `• ${item}`)])
  return [
    'Title:', contents.title,
    '', 'Description:', contents.description,
    '', 'Checklists:', ...(checklist.length ? checklist : ['None']),
    '', 'Labels:', ...(contents.labels.length ? contents.labels.map((label) => `• ${label}`) : ['None']),
    '', 'Priority:', contents.priority,
  ].join('\n')
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!)

export function cardContentsHtml(contents: CardContents): string {
  const list = (items: string[]) => `<ul>${items.map((item) => `<li style="white-space:pre-wrap">${escapeHtml(item)}</li>`).join('')}</ul>`
  return [
    '<section>', '<p><strong>Title:</strong></p>', `<p>${escapeHtml(contents.title)}</p>`,
    '<p><strong>Description:</strong></p>', `<p style="white-space:pre-wrap">${escapeHtml(contents.description)}</p>`,
    '<p><strong>Checklists:</strong></p>',
    ...(contents.groups.length
      ? contents.groups.flatMap((group) => [`<p><strong>${escapeHtml(group.name)}</strong></p>`, list(group.items)])
      : ['<p>None</p>']),
    '<p><strong>Labels:</strong></p>', contents.labels.length ? list(contents.labels) : '<p>None</p>',
    '<p><strong>Priority:</strong></p>', `<p>${escapeHtml(contents.priority)}</p>`, '</section>',
  ].join('')
}
