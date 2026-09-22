import { describe, expect, it } from 'vitest'
import type { BoardTask } from '@/lib/store/boardStore'
import { buildCardContents, cardContentsHtml, cardContentsText } from '../card-contents'

const task: BoardTask = {
  id: 't1', projectId: 'p1', name: 'Plan <release>', description: 'Line one\nLine two & more',
  status: 'todo', priority: 'urgent', color: 'purple', labels: ['l2', 'l1'], onTimeline: false, orderIndex: 0,
}

describe('card contents extraction', () => {
  it('keeps every checklist item in source order, resolves labels and a custom priority, and escapes rich copy', () => {
    const contents = buildCardContents(task, [
      { groupName: 'Launch', title: 'First & foremost' },
      { groupName: 'Launch', title: 'Second <script>' },
      { groupName: 'Review', title: 'Read "notes"' },
      { groupName: 'Launch', title: 'Last launch item' },
    ], [{ id: 'l1', name: 'Design' }, { id: 'l2', name: 'Needs <review>' }], 'Critical')

    expect(contents.groups).toEqual([
      { name: 'Launch', items: ['First & foremost', 'Second <script>', 'Last launch item'] },
      { name: 'Review', items: ['Read "notes"'] },
    ])
    expect(contents.labels).toEqual(['Needs <review>', 'Design'])
    expect(cardContentsText(contents)).toBe('Title:\nPlan <release>\n\nDescription:\nLine one\nLine two & more\n\nChecklists:\nLaunch\n• First & foremost\n• Second <script>\n• Last launch item\nReview\n• Read "notes"\n\nLabels:\n• Needs <review>\n• Design\n\nPriority:\nCritical')
    const html = cardContentsHtml(contents)
    expect(html).toContain('Plan &lt;release&gt;')
    expect(html).toContain('<p style="white-space:pre-wrap">Line one\nLine two &amp; more</p>')
    expect(html).toContain('<li style="white-space:pre-wrap">Second &lt;script&gt;</li>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('<strong>Priority:</strong></p><p>Critical</p>')
  })

  it('marks absent checklists and labels without inventing data', () => {
    const contents = buildCardContents({ ...task, labels: [], description: '' }, [], [], 'Urgent')
    expect(cardContentsText(contents)).toContain('Checklists:\nNone\n\nLabels:\nNone')
  })

  it('keeps mixed checklist states and multiline titles consistent in plain and rich copy', () => {
    const contents = buildCardContents(task, [
      { groupName: 'Progress', title: 'Open\nfollow-up', state: 'unchecked', completed: false },
      { groupName: 'Progress', title: 'Shipped & tested', state: 'checked', completed: true },
      { groupName: 'Progress', title: 'Discarded <idea>', state: 'crossed', completed: false },
      { groupName: 'Progress', title: 'Legacy complete', state: null, completed: true },
      { groupName: 'Progress', title: 'Explicitly open', state: 'unchecked', completed: true },
    ], [], 'Urgent')
    expect(contents.groups[0].items).toEqual([
      'Open\nfollow-up', 'Shipped & tested (Done)', 'Discarded <idea> (Not doing)',
      'Legacy complete (Done)', 'Explicitly open',
    ])
    const plain = cardContentsText(contents)
    const html = cardContentsHtml(contents)
    expect(plain).toContain('• Open\nfollow-up\n• Shipped & tested (Done)\n• Discarded <idea> (Not doing)\n• Legacy complete (Done)\n• Explicitly open')
    expect(html).toContain('<li style="white-space:pre-wrap">Open\nfollow-up</li>')
    expect(html).toContain('<li style="white-space:pre-wrap">Shipped &amp; tested (Done)</li>')
    expect(html).toContain('<li style="white-space:pre-wrap">Discarded &lt;idea&gt; (Not doing)</li>')
    expect(html).toContain('<li style="white-space:pre-wrap">Legacy complete (Done)</li>')
    expect(html).toContain('<li style="white-space:pre-wrap">Explicitly open</li>')
  })
})
