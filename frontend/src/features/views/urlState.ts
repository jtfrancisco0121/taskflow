import type { ViewConfig, ViewFilter } from '../../api/types'

/**
 * AD-4, AD-19: the URL carries the parts of a View config that differ from the saved view:
 * `f` filter tree (base64url JSON), `g` grouping, `s` sort (`dueDate.asc,title.desc`), `c` columns
 * (`title:300,status:120`), `m` Calendar mode and `d` Calendar anchor day. An invalid parameter is
 * dropped and reported, never an error page (VIEW-3).
 */
export type Sort = { key: string; dir: 'asc' | 'desc' }
export type Column = { field: string; width?: number }

export type UrlState = {
  f?: ViewFilter
  g?: string
  s?: Sort[]
  c?: Column[]
  m?: 'month' | 'week'
  d?: string
}

export const URL_KEYS = ['f', 'g', 's', 'c', 'm', 'd'] as const

const GROUPS = ['none', 'status', 'statusGroup', 'priority', 'assignee', 'dueDate', 'list']
const SORT_KEYS = [
  'manual',
  'title',
  'status',
  'priority',
  'dueDate',
  'startDate',
  'createdAt',
  'updatedAt',
]
export const COLUMN_FIELDS = [
  'readableId',
  'title',
  'status',
  'priority',
  'assignees',
  'dueDate',
  'startDate',
  'tags',
  'list',
  'createdAt',
  'updatedAt',
]
/** AD-8: a custom field is `cf:<fieldId>` wherever a built-in key is allowed. */
const CUSTOM_REF = /^cf:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isCustomRef = (field: string) => CUSTOM_REF.test(field)
export const MIN_WIDTH = 60
export const MAX_WIDTH = 800

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function b64decode(text: string): string {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

function validFilter(node: unknown, depth: number, count: { n: number }): node is ViewFilter {
  if (typeof node !== 'object' || node === null) return false
  const f = node as ViewFilter
  if (f.items) {
    if (depth > 3 || (f.op !== 'AND' && f.op !== 'OR') || !Array.isArray(f.items)) return false
    return f.items.every((child) => validFilter(child, depth + 1, count))
  }
  count.n += 1
  return count.n <= 50 && typeof f.field === 'string' && typeof f.op === 'string'
}

export function encodeFilter(filter: ViewFilter): string {
  return b64encode(JSON.stringify(filter))
}

export function encodeSort(sort: Sort[]): string {
  return sort.map((s) => `${s.key}.${s.dir}`).join(',')
}

export function encodeColumns(columns: Column[]): string {
  return columns.map((c) => (c.width ? `${c.field}:${c.width}` : c.field)).join(',')
}

function decodeSort(text: string): Sort[] | undefined {
  const out: Sort[] = []
  for (const part of text.split(',')) {
    const [key, dir] = part.split('.')
    if (!(SORT_KEYS.includes(key) || isCustomRef(key)) || (dir !== 'asc' && dir !== 'desc')) {
      return undefined
    }
    out.push({ key, dir })
  }
  return out.length >= 1 && out.length <= 2 ? out : undefined
}

function decodeColumns(text: string): Column[] | undefined {
  const out: Column[] = []
  for (const part of text.split(',')) {
    // `cf:<id>` has a colon of its own, so a width is a trailing `:<digits>` only.
    const sized = /^(.*):(\d+)$/.exec(part)
    const field = sized ? sized[1] : part
    const width = sized ? sized[2] : undefined
    if (!COLUMN_FIELDS.includes(field) && !isCustomRef(field)) return undefined
    if (width !== undefined) {
      const w = Number(width)
      if (!Number.isInteger(w) || w < MIN_WIDTH || w > MAX_WIDTH) return undefined
      out.push({ field, width: w })
    } else out.push({ field })
  }
  return out.some((c) => c.field === 'title') ? out : undefined
}

/** Reads the view parameters; `dropped` lists the ones that were invalid (for the notice). */
export function parseUrlState(params: URLSearchParams): { state: UrlState; dropped: string[] } {
  const state: UrlState = {}
  const dropped: string[] = []
  const f = params.get('f')
  if (f !== null) {
    try {
      const parsed: unknown = JSON.parse(b64decode(f))
      if (validFilter(parsed, 1, { n: 0 })) state.f = parsed
      else dropped.push('f')
    } catch {
      dropped.push('f')
    }
  }
  const g = params.get('g')
  if (g !== null) {
    if (GROUPS.includes(g) || isCustomRef(g)) state.g = g
    else dropped.push('g')
  }
  const s = params.get('s')
  if (s !== null) {
    const parsed = decodeSort(s)
    if (parsed) state.s = parsed
    else dropped.push('s')
  }
  const c = params.get('c')
  if (c !== null) {
    const parsed = decodeColumns(c)
    if (parsed) state.c = parsed
    else dropped.push('c')
  }
  const m = params.get('m')
  if (m !== null) {
    if (m === 'month' || m === 'week') state.m = m
    else dropped.push('m')
  }
  const d = params.get('d')
  if (d !== null) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))) state.d = d
    else dropped.push('d')
  }
  return { state, dropped }
}

/** Writes the state into a copy of the params, leaving every other parameter alone. */
export function writeUrlState(params: URLSearchParams, state: UrlState): URLSearchParams {
  const next = new URLSearchParams(params)
  URL_KEYS.forEach((key) => next.delete(key))
  if (state.f) next.set('f', encodeFilter(state.f))
  if (state.g) next.set('g', state.g)
  if (state.s?.length) next.set('s', encodeSort(state.s))
  if (state.c?.length) next.set('c', encodeColumns(state.c))
  if (state.m) next.set('m', state.m)
  if (state.d) next.set('d', state.d)
  return next
}

/** "Save view" stores the effective config and clears the parameters. */
export function clearUrlState(params: URLSearchParams): URLSearchParams {
  return writeUrlState(params, {})
}

/** The saved config with the URL parameters laid over it. */
export function applyUrlState(base: ViewConfig, state: UrlState): ViewConfig {
  return {
    ...base,
    v: 1,
    ...(state.f ? { filter: state.f } : {}),
    ...(state.g ? { group: state.g } : {}),
    ...(state.s ? { sort: state.s } : {}),
    ...(state.c ? { columns: state.c } : {}),
    ...(state.m ? { mode: state.m } : {}),
  }
}

export function isDirty(state: UrlState): boolean {
  return Object.keys(state).length > 0
}

/** A short stable hash of the parts of a config that change the rows (query key, cursor scope). */
export function configHash(config: ViewConfig): string {
  const text = JSON.stringify([config.filter ?? null, config.group ?? null, config.sort ?? null])
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** The `cf:` references a config uses in its filter, sort, group and columns. */
export function customRefs(config: ViewConfig): string[] {
  const refs = new Set<string>()
  const walk = (f: ViewFilter | undefined) => {
    if (!f) return
    if (f.items) f.items.forEach(walk)
    else if (f.field && isCustomRef(f.field)) refs.add(f.field)
  }
  walk(config.filter)
  config.sort?.forEach((s) => s.key && isCustomRef(s.key) && refs.add(s.key))
  if (config.group && isCustomRef(config.group)) refs.add(config.group)
  config.columns?.forEach((c) => c.field && isCustomRef(c.field) && refs.add(c.field))
  return [...refs]
}

/** What to put in the URL so the given references are gone from the config ("Remove from view"). */
export function withoutRefs(config: ViewConfig, gone: string[]): Partial<UrlState> {
  const drop = new Set(gone)
  const prune = (f: ViewFilter | undefined): ViewFilter | undefined => {
    if (!f) return undefined
    if (!f.items) return f.field && drop.has(f.field) ? undefined : f
    const items = f.items.flatMap((i) => prune(i) ?? [])
    return items.length ? { ...f, items } : undefined
  }
  const sort = (config.sort ?? []).filter((s) => !(s.key && drop.has(s.key)))
  const columns = (config.columns ?? []).filter((c) => !(c.field && drop.has(c.field)))
  return {
    f: prune(config.filter) ?? { op: 'AND', items: [] },
    s: sort.length ? (sort as Sort[]) : [{ key: 'manual', dir: 'asc' }],
    g: config.group && drop.has(config.group) ? 'none' : config.group,
    ...(columns.length ? { c: columns as Column[] } : {}),
  }
}
