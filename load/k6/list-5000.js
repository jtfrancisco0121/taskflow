// k6 load script for the seeded 5,000-task List (FR-21, NFR-1).
//
//   node scripts/seed/demo.mjs                 # once: creates the "Load Test / Load 5000" List
//   k6 run -e API_URL=http://localhost:8080 load/k6/list-5000.js
//
// What it proves:
//   - paging POST /api/v1/views/query to the end under a manual and a due-date sort returns every
//     task of the List exactly once (a repeated or missing task fails the run);
//   - a view page answers in under 300 ms at the 95th percentile while other users edit tasks
//     with PATCH /api/v1/tasks/{id} and If-Match (a 409 is a correct answer to a lost race);
//   - dependencies (DEP, SM-3): setup makes about BLOCKED_SHARE (default 0.1) of the tasks wait on
//     another unfinished task of the List (a rerun gets 409 dependency.exists, which is fine), so the
//     view pages above are measured with `blocked` computed; the `blocked` scenario pages the
//     `is_true` filter, checks every blocked task appears exactly once (the expected count comes from
//     the task list's own `blocked` flag) and holds it to the same 300 ms p95.
import http from 'k6/http'
import { check, group } from 'k6'
import { Counter } from 'k6/metrics'

const API = (__ENV.API_URL || 'http://localhost:8080').replace(/\/$/, '')
const EMAIL = __ENV.OWNER_EMAIL || 'demo-owner@example.com'
const PASSWORD = __ENV.PASSWORD || 'demo-password-2026'
const WORKSPACE = __ENV.WORKSPACE || 'Demo'
const SPACE = __ENV.SPACE || 'Load Test'
const LIST = __ENV.LIST || 'Load 5000'
const PAGE = Number(__ENV.PAGE_SIZE || 200)
const CUSTOM_FIELD = __ENV.CUSTOM_FIELD || 'Load score'
const BLOCKED_SHARE = Number(__ENV.BLOCKED_SHARE || 0.1)

const pagingFailures = new Counter('paging_integrity_failures')

export const options = {
  setupTimeout: '5m',
  scenarios: {
    paging: {
      executor: 'per-vu-iterations',
      exec: 'paging',
      vus: Number(__ENV.PAGING_VUS || 5),
      iterations: Number(__ENV.PAGING_ITERATIONS || 4),
      maxDuration: '10m',
    },
    // SM-2: a custom field filter and sort over the same List (skipped when the field is missing)
    custom: {
      executor: 'per-vu-iterations',
      exec: 'custom',
      vus: Number(__ENV.CUSTOM_VUS || 3),
      iterations: Number(__ENV.CUSTOM_ITERATIONS || 4),
      maxDuration: '10m',
    },
    // SM-3: the "is blocked" filter paged to the end (skipped when no task is blocked)
    blocked: {
      executor: 'per-vu-iterations',
      exec: 'blocked',
      vus: Number(__ENV.BLOCKED_VUS || 3),
      iterations: Number(__ENV.BLOCKED_ITERATIONS || 4),
      maxDuration: '10m',
    },
    edits: {
      executor: 'constant-vus',
      exec: 'edits',
      vus: Number(__ENV.EDIT_VUS || 5),
      duration: __ENV.EDIT_DURATION || '40s',
    },
  },
  thresholds: {
    'http_req_duration{type:view_page}': ['p(95)<300'],
    'http_req_duration{type:custom_page}': ['p(95)<300'],
    'http_req_duration{type:blocked_page}': ['p(95)<300'],
    'http_req_duration{type:task_edit}': ['p(95)<500'],
    paging_integrity_failures: ['count==0'],
    'checks{check:page ok}': ['rate==1'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max'],
}

const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
})

function get(path, token, type) {
  return http.get(`${API}${path}`, { headers: headers(token), tags: { type } })
}

function child(workspaceId, parentId, name, token) {
  const query = parentId ? `?parentId=${parentId}` : ''
  const res = get(`/api/v1/workspaces/${workspaceId}/tree${query}`, token, 'setup')
  return (res.json('items') || []).find((n) => n.name === name)
}

/** Signs in once (sign-in is limited to 20 per IP per minute) and finds the seeded List. */
export function setup() {
  const login = http.post(
    `${API}/api/v1/auth/signin`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { type: 'setup' } },
  )
  if (login.status !== 200) throw new Error(`sign-in failed (${login.status}); run scripts/seed/demo.mjs first`)
  const token = login.json('accessToken')
  const workspaces = get('/api/v1/workspaces?limit=100', token, 'setup').json('items') || []
  const workspace = workspaces.find((w) => w.name === WORKSPACE)
  if (!workspace) throw new Error(`no Workspace "${WORKSPACE}"; run scripts/seed/demo.mjs first`)
  const space = child(workspace.id, null, SPACE, token)
  const list = space && child(workspace.id, space.id, LIST, token)
  if (!list) throw new Error(`no List "${SPACE} / ${LIST}"; run scripts/seed/demo.mjs first`)

  // the List's real size and a handful of task ids for the edit scenario
  const listAll = () => {
    const all = []
    let next
    do {
      const res = get(`/api/v1/tasks?locationId=${list.id}&limit=200${next ? `&cursor=${next}` : ''}`, token, 'setup')
      all.push(...(res.json('items') || []))
      next = res.json('nextCursor')
    } while (next)
    return all
  }
  const tasks = listAll()
  const size = tasks.length
  const ids = tasks.slice(0, 200).map((t) => t.id)
  console.log(`List "${LIST}" has ${size} tasks`)
  const blockedCount = makeBlocked(token, list.id, tasks, listAll)
  const fields = get(`/api/v1/locations/${list.id}/fields`, token, 'setup').json('fields') || []
  const custom = fields.find((f) => f.name === CUSTOM_FIELD)
  if (!custom) console.log(`no custom field "${CUSTOM_FIELD}": the custom scenario is skipped (run scripts/seed/demo.mjs)`)
  return { token, listId: list.id, size, ids, fieldId: custom && custom.id, blockedCount }
}

/**
 * Makes about BLOCKED_SHARE of the tasks wait on the next task of the List that is unfinished and
 * not itself a dependent, so there is never a loop. A rerun answers 409 for existing pairs. Returns
 * how many tasks are blocked afterwards, counted from the task list's own `blocked` flag.
 */
function makeBlocked(token, listId, tasks, listAll) {
  if (BLOCKED_SHARE <= 0) return 0
  const statuses = get(`/api/v1/locations/${listId}/statuses`, token, 'setup').json('statuses') || []
  const finished = new Set(statuses.filter((s) => s.group === 'DONE' || s.group === 'CLOSED').map((s) => s.id))
  const step = Math.max(Math.round(1 / BLOCKED_SHARE), 2)
  let created = 0
  for (let i = 0; i + 1 < tasks.length; i += step) {
    const waiting = tasks[i]
    const blocker = tasks[i + 1]
    if (finished.has(blocker.statusId)) continue
    const res = http.post(
      `${API}/api/v1/tasks/${waiting.id}/dependencies`,
      JSON.stringify({ otherTaskId: blocker.id, relation: 'WAITING_ON' }),
      { headers: { ...headers(token), 'If-Match': `"${waiting.version}"` }, tags: { type: 'setup' } },
    )
    if (res.status === 201) created++
    else if (res.status !== 409) console.log(`dependency setup: ${res.status} ${res.body}`)
  }
  const blocked = listAll().filter((t) => t.blocked).length
  console.log(`${created} dependencies created, ${blocked} blocked tasks in the List`)
  return blocked
}

function pageAll(data, sort) {
  const seen = new Set()
  let cursor
  let pages = 0
  do {
    const res = http.post(
      `${API}/api/v1/views/query`,
      JSON.stringify({
        scope: { locationId: data.listId },
        config: { v: 1, sort: [{ key: sort, dir: 'asc' }] },
        limit: PAGE,
        cursor,
      }),
      { headers: headers(data.token), tags: { type: 'view_page' } },
    )
    const ok = check(res, { 'page ok': (r) => r.status === 200 })
    if (!ok) return
    for (const item of res.json('items')) {
      if (seen.has(item.task.id)) pagingFailures.add(1)
      seen.add(item.task.id)
    }
    cursor = res.json('nextCursor')
    pages++
  } while (cursor && pages < 1000)
  // a skipped task shows as a smaller count; a repeated one was counted above
  if (seen.size !== data.size) pagingFailures.add(1)
  check(seen.size, { [`${sort}: every task exactly once`]: (n) => n === data.size })
}

export function paging(data) {
  group('manual sort', () => pageAll(data, 'manual'))
  group('due date sort', () => pageAll(data, 'dueDate'))
}

/** Pages the List filtered on "Load score >= 500" and sorted by it, descending (SM-2). */
export function custom(data) {
  if (!data.fieldId) return
  const seen = new Set()
  let cursor
  let pages = 0
  do {
    const res = http.post(
      `${API}/api/v1/views/query`,
      JSON.stringify({
        scope: { locationId: data.listId },
        config: {
          v: 1,
          filter: { op: 'AND', items: [{ field: `cf:${data.fieldId}`, op: 'gte', value: 500 }] },
          sort: [{ key: `cf:${data.fieldId}`, dir: 'desc' }],
        },
        limit: PAGE,
        cursor,
      }),
      { headers: headers(data.token), tags: { type: 'custom_page' } },
    )
    if (!check(res, { 'custom page ok': (r) => r.status === 200 })) return
    for (const item of res.json('items')) {
      if (seen.has(item.task.id)) pagingFailures.add(1)
      seen.add(item.task.id)
    }
    cursor = res.json('nextCursor')
    pages++
  } while (cursor && pages < 1000)
}

/** Pages the List filtered on "is blocked": every blocked task exactly once (SM-3). */
export function blocked(data) {
  if (!data.blockedCount) return
  const seen = new Set()
  let cursor
  let pages = 0
  do {
    const res = http.post(
      `${API}/api/v1/views/query`,
      JSON.stringify({
        scope: { locationId: data.listId },
        config: { v: 1, filter: { op: 'AND', items: [{ field: 'blocked', op: 'is_true' }] } },
        limit: PAGE,
        cursor,
      }),
      { headers: headers(data.token), tags: { type: 'blocked_page' } },
    )
    if (!check(res, { 'blocked page ok': (r) => r.status === 200 })) return
    for (const item of res.json('items')) {
      if (seen.has(item.task.id)) pagingFailures.add(1)
      seen.add(item.task.id)
    }
    cursor = res.json('nextCursor')
    pages++
  } while (cursor && pages < 1000)
  // the edit scenario only changes priority, so the blocked set cannot change during the run
  if (seen.size !== data.blockedCount) pagingFailures.add(1)
  check(seen.size, { 'blocked: every blocked task exactly once': (n) => n === data.blockedCount })
}

export function edits(data) {
  const id = data.ids[Math.floor(Math.random() * data.ids.length)]
  const current = get(`/api/v1/tasks/${id}`, data.token, 'task_read')
  if (current.status !== 200) return
  const version = current.json('version')
  const res = http.patch(
    `${API}/api/v1/tasks/${id}`,
    JSON.stringify({ priority: ['URGENT', 'HIGH', 'NORMAL', 'LOW'][__ITER % 4] }),
    { headers: { ...headers(data.token), 'If-Match': `"${version}"` }, tags: { type: 'task_edit' } },
  )
  // 409: another edit won the race and the response carries the current task
  check(res, { 'edit saved or conflicted': (r) => r.status === 200 || r.status === 409 })
}
