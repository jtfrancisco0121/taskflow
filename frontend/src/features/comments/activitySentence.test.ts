import { describe, expect, it } from 'vitest'
import type { ActivityView } from '../../api/types'
import { actorLabel, activitySentences, relatedTaskIds, type NameLookup } from './activitySentence'

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

describe('actorLabel', () => {
  it('UJ-2: a service account is "name (key key-name)"', () => {
    expect(
      actorLabel({
        actorType: 'SERVICE_ACCOUNT',
        actorName: 'triage-agent',
        actorKeyName: 'CI-1',
      }),
    ).toBe('triage-agent (key CI-1)')
  })

  it('a service account whose key has no name, a user and a missing name fall back', () => {
    expect(actorLabel({ actorType: 'SERVICE_ACCOUNT', actorName: 'triage-agent' })).toBe(
      'triage-agent',
    )
    expect(actorLabel({ actorType: 'USER', actorName: 'Maya Lopez' })).toBe('Maya Lopez')
    expect(actorLabel({ actorType: 'USER' })).toBe('Someone')
  })

  it('CAP-7: a rule reads "by automation <rule>", the system reads "Taskflow"', () => {
    expect(
      actorLabel({
        actorType: 'AUTOMATION',
        actorName: 'Done to QA',
        automationRuleName: 'Done to QA',
      }),
    ).toBe('by automation Done to QA')
    expect(actorLabel({ actorType: 'AUTOMATION', actorName: 'Taskflow' })).toBe('Taskflow')
    expect(actorLabel({ actorType: 'AUTOMATION', actorName: 'Taskflow' })).not.toMatch(
      /by automation/,
    )
  })

  it('the due-date events have their own sentences', () => {
    expect(
      activitySentences({ type: 'task.due_soon' }, { statusName: () => '', memberName: () => '' }),
    ).toEqual(['Due date approaching'])
    expect(
      activitySentences(
        { type: 'task.due_reached' },
        { statusName: () => '', memberName: () => '' },
      ),
    ).toEqual(['Due date reached'])
  })

  it('a user without an email still has a display name to show', () => {
    expect(actorLabel({ actorType: 'USER', actorName: 'Maya Lopez' })).not.toMatch(/@/)
  })

  it('FIELD-3: custom field changes read "set <field> to <value>" and "cleared <field>"', () => {
    const lines = activitySentences(
      entry('task.updated', {
        changes: {
          customFields: {
            'f-1': {
              from: null,
              to: 'o2',
              field: 'Customer tier',
              fromText: '',
              toText: 'Enterprise',
            },
            'f-2': { from: 5, to: null, field: 'Story points', fromText: '5', toText: '' },
          },
        },
      }),
      lookup,
    )
    expect(lines).toEqual(['set Customer tier to Enterprise', 'cleared Story points'])
    expect(lines.join(' ')).not.toMatch(UUID_RE)
  })

  it('custom field lines come after the other changes, and a created task lists the values it started with', () => {
    expect(
      activitySentences(
        entry('task.updated', {
          changes: {
            title: { from: 'A', to: 'B' },
            customFields: { 'f-1': { field: 'Notes', toText: 'call back' } },
          },
        }),
        lookup,
      ),
    ).toEqual(['changed title from A to B', 'set Notes to call back'])
    expect(
      activitySentences(
        entry('task.created', {
          changes: { customFields: { 'f-1': { field: 'Customer tier', toText: 'Enterprise' } } },
        }),
        lookup,
      ),
    ).toEqual(['created this task', 'set Customer tier to Enterprise'])
  })

  it('an actor that is a service account reads "name (key K)"', () => {
    expect(
      actorLabel({
        actorName: 'triage-agent',
        actorType: 'SERVICE_ACCOUNT',
        actorKeyName: 'CI-1',
      } as ActivityView),
    ).toBe('triage-agent (key CI-1)')
  })

  describe('DEP relationships and blocker events', () => {
    const tasks: NameLookup = {
      ...lookup,
      taskName: (id) => ({ b1: 'TF-87', b2: 'TF-12', gone: null })[id],
    }

    it('FR-9: an added or removed relationship names the relation and the other task', () => {
      expect(
        activitySentences(
          entry('task.dependency_added', { relation: 'WAITING_ON', otherTaskId: 'b1' }),
          tasks,
        ),
      ).toEqual(['added: waiting on TF-87'])
      expect(
        activitySentences(
          entry('task.dependency_removed', { relation: 'LINKED', otherTaskId: 'b2' }),
          tasks,
        ),
      ).toEqual(['removed: linked to TF-12'])
      expect(
        activitySentences(
          entry('task.dependency_added', { relation: 'BLOCKING', otherTaskId: 'b1' }),
          tasks,
        ),
      ).toEqual(['added: blocking TF-87'])
    })

    it('AD-6: a task the caller cannot read is "a task you can\'t see", never an id', () => {
      const [line] = activitySentences(
        entry('task.dependency_added', { relation: 'WAITING_ON', otherTaskId: 'gone' }),
        tasks,
      )
      expect(line).toBe("added: waiting on a task you can't see")
      expect(line).not.toMatch(UUID_RE)
      // not resolved yet
      expect(
        activitySentences(
          entry('task.dependency_added', { relation: 'WAITING_ON', otherTaskId: 'later' }),
          tasks,
        ),
      ).toEqual(['added: waiting on another task'])
    })

    it('FR-8: a blocker that finished or came back reads as a sentence', () => {
      const sentence = (type: string, payload: object) =>
        activitySentences(entry(type, { blockerId: 'b1', ...payload }), tasks)
      expect(
        sentence('task.blocker_resolved', { reason: 'completed', stillBlocked: false }),
      ).toEqual(['TF-87 was completed'])
      expect(sentence('task.blocker_resolved', { reason: 'trashed', stillBlocked: false })).toEqual(
        ['TF-87 was trashed'],
      )
      expect(
        sentence('task.blocker_resolved', { reason: 'completed', stillBlocked: true }),
      ).toEqual(['TF-87 was completed; still waiting on other tasks'])
      expect(sentence('task.blocker_reopened', { reason: 'reopened' })).toEqual([
        'TF-87 was reopened',
      ])
      expect(sentence('task.blocker_reopened', { reason: 'restored' })).toEqual([
        'TF-87 was restored',
      ])
    })

    it('lists the other task ids an entry needs resolved', () => {
      expect(
        relatedTaskIds(entry('task.dependency_added', { otherTaskId: 'b1', relation: 'LINKED' })),
      ).toEqual(['b1'])
      expect(relatedTaskIds(entry('task.blocker_resolved', { blockerId: 'b2' }))).toEqual(['b2'])
      expect(relatedTaskIds(entry('task.updated', { otherTaskId: 'x' }))).toEqual([])
    })
  })
})
