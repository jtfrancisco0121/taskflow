import { describe, expect, it } from 'vitest'
import {
  applyUrlState,
  clearUrlState,
  configHash,
  isDirty,
  customRefs,
  encodeFilter,
  parseUrlState,
  withoutRefs,
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

  it('FIELD-3: cf: references round-trip in f, s and g', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const state = {
      f: { op: 'AND', items: [{ field: `cf:${id}`, op: 'any_of', value: ['o1'] }] },
      s: [{ key: `cf:${id}`, dir: 'desc' as const }],
      g: `cf:${id}`,
    }
    const params = writeUrlState(new URLSearchParams(), state)
    expect(parseUrlState(params)).toEqual({ state, dropped: [] })
  })

  it('a malformed cf: sort or group is dropped like any invalid parameter', () => {
    expect(parseUrlState(new URLSearchParams('s=cf:nope.asc')).dropped).toEqual(['s'])
    expect(parseUrlState(new URLSearchParams('g=cf:nope')).dropped).toEqual(['g'])
  })

  it('finds the references of a config and removes them for "Remove from view"', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const other = '22222222-2222-4222-8222-222222222222'
    const config = {
      v: 1,
      filter: {
        op: 'AND',
        items: [
          { field: `cf:${id}`, op: 'is_set' },
          { field: 'priority', op: 'any_of', value: ['URGENT'] },
        ],
      },
      sort: [{ key: `cf:${id}`, dir: 'asc' }],
      group: `cf:${other}`,
      columns: [{ field: 'title' }, { field: `cf:${id}` }],
    }
    expect(customRefs(config).sort()).toEqual([`cf:${id}`, `cf:${other}`].sort())
    const patch = withoutRefs(config, [`cf:${id}`])
    expect(patch.f).toEqual({
      op: 'AND',
      items: [{ field: 'priority', op: 'any_of', value: ['URGENT'] }],
    })
    expect(patch.s).toEqual([{ key: 'manual', dir: 'asc' }])
    expect(patch.g).toBe(`cf:${other}`)
    expect(patch.c).toEqual([{ field: 'title' }])
  })
})

describe('VIEW-3 blocked filter in the URL (FR-7)', () => {
  it('round-trips {field: "blocked", op: "is_true"} through f', () => {
    const state: UrlState = {
      f: { op: 'AND', items: [{ field: 'blocked', op: 'is_true' }] },
    }
    const params = writeUrlState(new URLSearchParams(), state)
    expect(params.get('f')).toBeTruthy()
    const parsed = parseUrlState(new URLSearchParams(params.toString()))
    expect(parsed.dropped).toEqual([])
    expect(parsed.state.f).toEqual(state.f)
  })
})

describe('AD-5 isDirty compares the URL with the saved view', () => {
  const urgent = { op: 'AND', items: [{ field: 'priority', op: 'any_of', value: ['URGENT'] }] }
  const saved = {
    v: 1,
    filter: urgent,
    group: 'status',
    sort: [{ key: 'dueDate', dir: 'asc' }],
    columns: [{ field: 'title', width: 300 }, { field: 'status' }],
    mode: 'week',
  }

  it('is not dirty with no parameter or with parameters equal to the saved values', () => {
    expect(isDirty(saved, {})).toBe(false)
    expect(
      isDirty(saved, {
        f: JSON.parse(JSON.stringify(urgent)),
        g: 'status',
        s: [{ key: 'dueDate', dir: 'asc' }],
        c: [{ field: 'title', width: 300 }, { field: 'status' }],
        m: 'week',
      }),
    ).toBe(false)
  })

  it('is dirty when any one of filter, group, sort, columns or mode differs', () => {
    expect(isDirty(saved, { f: { op: 'AND', items: [] } })).toBe(true)
    expect(isDirty(saved, { g: 'priority' })).toBe(true)
    expect(isDirty(saved, { s: [{ key: 'dueDate', dir: 'desc' }] })).toBe(true)
    expect(isDirty(saved, { c: [{ field: 'title' }] })).toBe(true)
    expect(isDirty(saved, { m: 'month' })).toBe(true)
  })

  it('never counts the Calendar day', () => {
    expect(isDirty(saved, { d: '2026-11-25' })).toBe(false)
  })

  it('normalises the defaults', () => {
    const empty = { v: 1 }
    expect(isDirty(empty, { f: { op: 'AND', items: [] } })).toBe(false)
    expect(isDirty(empty, { f: { op: 'OR', items: [] } })).toBe(false)
    expect(isDirty(empty, { g: 'none' })).toBe(false)
    expect(isDirty(empty, { s: [{ key: 'manual', dir: 'asc' }] })).toBe(false)
    expect(isDirty(empty, { m: 'month' })).toBe(false)
    expect(isDirty(empty, { m: 'week' })).toBe(true)
    expect(isDirty(empty, { s: [{ key: 'manual', dir: 'desc' }] })).toBe(true)
  })

  it('treats a leaf filter root as a one-item AND group', () => {
    const leaf = { field: 'priority', op: 'any_of', value: ['URGENT'] }
    expect(isDirty({ v: 1, filter: leaf }, { f: { op: 'AND', items: [leaf] } })).toBe(false)
    expect(isDirty({ v: 1, filter: { op: 'AND', items: [leaf] } }, { f: leaf })).toBe(false)
    expect(isDirty({ v: 1, filter: leaf }, { f: { op: 'AND', items: [] } })).toBe(true)
  })
})
