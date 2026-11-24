import { describe, expect, it } from 'vitest'
import type { StatusInfo } from '../../api/types'
import { draftTargets, removedStatuses, resolveRemap } from './buildRemap'
import type { DraftRow } from './statusTypes'

const st = (id: string, name: string): StatusInfo => ({ id, name })
const draft = (key: string, name: string, id?: string): DraftRow => ({
  key,
  id,
  name,
  group: 'ACTIVE',
  color: '#3b82f6',
})

describe('buildRemap', () => {
  const current = [st('a', 'to do'), st('b', 'in progress'), st('c', 'complete')]

  it('FR-23: on an own set only statuses no draft keeps are removed', () => {
    const drafts = [draft('a', 'Backlog', 'a'), draft('c', 'complete', 'c')]
    expect(removedStatuses(current, drafts, false).map((s) => s.id)).toEqual(['b'])
  })

  it('FR-23: on an inheriting location every inherited status is removed (drafts have no ids)', () => {
    const drafts = [draft('n1', 'to do'), draft('n2', 'complete')]
    expect(removedStatuses(current, drafts, true).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('FR-23: same-name targets are matched trimmed and case-insensitively, others need a choice', () => {
    const drafts = [draft('n1', ' To Do '), draft('n2', 'complete')]
    const result = resolveRemap(current, draftTargets(drafts), {})
    expect(result.remap).toEqual([
      { from: 'a', to: 'To Do' },
      { from: 'c', to: 'complete' },
    ])
    expect(result.needsChoice.map((s) => s.id)).toEqual(['b'])
    expect(result.unresolved.map((s) => s.id)).toEqual(['b'])
  })

  it('FR-23: a choice supplies the target by its current name, never its id', () => {
    const drafts = [draft('n1', 'Backlog'), draft('n2', 'complete')]
    const result = resolveRemap(current, draftTargets(drafts), { a: 'n1', b: 'n1' })
    expect(result.unresolved).toEqual([])
    expect(result.remap).toEqual([
      { from: 'a', to: 'Backlog' },
      { from: 'b', to: 'Backlog' },
      { from: 'c', to: 'complete' },
    ])
    expect(result.remap.every((r) => r.to !== 'n1')).toBe(true)
  })

  it('FR-23: a choice whose draft was removed or renamed away no longer counts', () => {
    const drafts = [draft('n2', 'complete')]
    const result = resolveRemap(current, draftTargets(drafts), { a: 'gone' })
    expect(result.unresolved.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('FR-23: nothing removed means no remap at all', () => {
    const drafts = current.map((s) => draft(s.id!, s.name!, s.id))
    const removed = removedStatuses(current, drafts, false)
    expect(resolveRemap(removed, draftTargets(drafts), {}).remap).toEqual([])
  })
})
