import { describe, expect, it } from 'vitest'
import {
  applyUrlState,
  clearUrlState,
  configHash,
  encodeFilter,
  parseUrlState,
  writeUrlState,
  type UrlState,
} from './urlState'

const filter = {
  op: 'AND',
  items: [
    { field: 'priority', op: 'any_of', value: ['URGENT'] },
    {
      op: 'OR',
      items: [
        { field: 'title', op: 'contains', value: 'bug ünï' },
        { field: 'assignee', op: 'any_of', value: ['me'] },
      ],
    },
  ],
}

describe('VIEW-3 URL state', () => {
  it('round-trips every parameter', () => {
    const state: UrlState = {
      f: filter,
      g: 'assignee',
      s: [
        { key: 'dueDate', dir: 'asc' },
        { key: 'title', dir: 'desc' },
      ],
      c: [{ field: 'title', width: 300 }, { field: 'status', width: 120 }, { field: 'tags' }],
      m: 'week',
      d: '2026-11-25',
    }
    const params = writeUrlState(new URLSearchParams('keep=1'), state)
    expect(params.get('keep')).toBe('1')
    expect(params.get('s')).toBe('dueDate.asc,title.desc')
    expect(params.get('c')).toBe('title:300,status:120,tags')
    const parsed = parseUrlState(new URLSearchParams(params.toString()))
    expect(parsed.dropped).toEqual([])
    expect(parsed.state).toEqual(state)
  })

  it('drops an invalid parameter with a notice and keeps the valid ones', () => {
    const params = new URLSearchParams({
      f: 'not-base64-json!!',
      g: 'planets',
      s: 'title.sideways',
      c: 'status:100',
      m: 'year',
      d: '2026-13-45',
    })
    params.set('g', 'status')
    const { state, dropped } = parseUrlState(params)
    expect(state).toEqual({ g: 'status' })
    expect(dropped).toEqual(['f', 's', 'c', 'm', 'd'])
  })

  it('refuses a column width outside 60 to 800, a missing title column and a deep filter', () => {
    expect(parseUrlState(new URLSearchParams('c=title:59')).dropped).toEqual(['c'])
    expect(parseUrlState(new URLSearchParams('c=title:801')).dropped).toEqual(['c'])
    expect(parseUrlState(new URLSearchParams('c=title:60,status:800')).dropped).toEqual([])
    const deep = {
      op: 'AND',
      items: [{ op: 'OR', items: [{ op: 'AND', items: [{ op: 'OR', items: [] }] }] }],
    }
    expect(parseUrlState(new URLSearchParams({ f: encodeFilter(deep) })).dropped).toEqual(['f'])
  })

  it('Save clears the view parameters and keeps the others', () => {
    const params = writeUrlState(new URLSearchParams('keep=1'), { g: 'priority', m: 'week' })
    const cleared = clearUrlState(params)
    expect(cleared.toString()).toBe('keep=1')
  })

  it('lays the URL over the saved config', () => {
    const base = { v: 1, group: 'status', sort: [{ key: 'manual', dir: 'asc' }] }
    const merged = applyUrlState(base, { g: 'priority', f: filter })
    expect(merged.group).toBe('priority')
    expect(merged.filter).toEqual(filter)
    expect(merged.sort).toEqual(base.sort)
  })

  it('hashes by the rows-changing parts only', () => {
    expect(configHash({ v: 1, group: 'a' })).toBe(configHash({ v: 1, group: 'a', mode: 'week' }))
    expect(configHash({ v: 1, group: 'a' })).not.toBe(configHash({ v: 1, group: 'b' }))
  })

  it('FIELD-3: cf:<id> columns round-trip through c, with and without a width', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const columns = [
      { field: 'title', width: 300 },
      { field: `cf:${id}`, width: 160 },
      { field: `cf:${id.replace(/1/g, '2')}` },
    ]
    const params = writeUrlState(new URLSearchParams(), { c: columns })
    expect(parseUrlState(params)).toEqual({ state: { c: columns }, dropped: [] })
  })

  it('a malformed cf: column drops c like any invalid column', () => {
    expect(parseUrlState(new URLSearchParams('c=title,cf:not-a-uuid')).dropped).toEqual(['c'])
    expect(parseUrlState(new URLSearchParams('c=title,cf:')).dropped).toEqual(['c'])
  })
})
