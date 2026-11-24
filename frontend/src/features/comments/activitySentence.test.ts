import { describe, expect, it } from 'vitest'
import type { ActivityView } from '../../api/types'
import { activitySentences, type NameLookup } from './activitySentence'

const lookup: NameLookup = {
  statusName: (id) => ({ s1: 'To do', s2: 'Done' })[id],
  memberName: (id) => ({ u1: 'Maya Lopez' })[id],
}
const entry = (type: string, payload?: object): ActivityView => ({ type, payload })
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

describe('activitySentences', () => {
  it('FR-21: names a status change by status names', () => {
    expect(
      activitySentences(
        entry('task.status_changed', { changes: { statusId: { from: 's1', to: 's2' } } }),
        lookup,
      ),
    ).toEqual(['changed status from To do to Done'])
  })

  it('FR-21: a status id that is not in the effective set becomes "a removed status"', () => {
    const [line] = activitySentences(
      entry('task.status_changed', {
        changes: { statusId: { from: '3f2b8f0e-aaaa-4bbb-8ccc-1234567890ab', to: 's2' } },
      }),
      lookup,
    )
    expect(line).toBe('changed status from a removed status to Done')
    expect(line).not.toMatch(UUID_RE)
  })

  it('FR-21: assignee ids show member names or "a former member"', () => {
    const [line] = activitySentences(
      entry('task.updated', {
        changes: { assigneeIds: { from: [], to: ['u1', '3f2b8f0e-aaaa-4bbb-8ccc-1234567890ab'] } },
      }),
      lookup,
    )
    expect(line).toBe('changed assignees from none to Maya Lopez, a former member')
  })

  it('FR-21: dates use the UTC day, null is "none", title and tags show their values', () => {
    expect(
      activitySentences(
        entry('task.updated', {
          changes: {
            dueDate: { from: null, to: '2025-12-03T00:00:00Z' },
            title: { from: 'A', to: 'B' },
            tags: { from: [], to: ['x', 'y'] },
            priority: { from: 'NORMAL', to: 'HIGH' },
          },
        }),
        lookup,
      ),
    ).toEqual([
      'changed due date from none to Dec 3, 2025',
      'changed title from A to B',
      'changed tags from none to x, y',
      'changed priority from Normal to High',
    ])
  })

  it('FR-21: a description change never shows its text', () => {
    expect(
      activitySentences(
        entry('task.updated', { changes: { description: { from: '(changed)', to: '(changed)' } } }),
        lookup,
      ),
    ).toEqual(['changed the description'])
  })

  it('FR-21: fixed sentences for the other types', () => {
    const line = (type: string) => activitySentences(entry(type), lookup)[0]
    expect(line('task.created')).toBe('created this task')
    expect(line('task.duplicated')).toBe('duplicated this task')
    expect(line('task.trashed')).toBe('moved this task to trash')
    expect(line('task.restored')).toBe('restored this task')
    expect(line('comment.created')).toBe('commented')
    expect(line('comment.edited')).toBe('edited a comment')
    expect(line('comment.deleted')).toBe('deleted a comment')
    expect(line('checklist.changed')).toBe('changed a checklist')
    expect(line('something.else')).toBe('changed this task')
  })

  it('FR-21: an unknown raw uuid in a free field is never shown', () => {
    const [line] = activitySentences(
      entry('task.updated', {
        changes: { parentTaskId: { from: null, to: '3f2b8f0e-aaaa-4bbb-8ccc-1234567890ab' } },
      }),
      lookup,
    )
    expect(line).not.toMatch(UUID_RE)
  })
})
