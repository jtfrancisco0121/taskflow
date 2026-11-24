#!/usr/bin/env node
// Seeds a demo Workspace through the public REST API only (Node 26, built-in fetch, no packages).
// Idempotent: every entity is looked up by its stable name before it is created, so a second run,
// or a run that follows an interrupted one, creates only what is missing. Idempotency-Key is sent
// as a retry guard only (the server forgets keys after 24 hours).
//   node scripts/seed/demo.mjs
import {
  BIG_LIST,
  CUSTOM_FIELDS,
  MEMBERS,
  OWNER,
  PASSWORD,
  STRUCTURE,
  WORKSPACE,
  assigneeIndexFor,
  commentText,
  doc,
  dueDateFor,
  hasComment,
  hasSubtask,
  keyFor,
  priorityFor,
  statusIndexFor,
  storyPointsFor,
  subtaskTitle,
  tagsFor,
  taskTitle,
  textOf,
  tierFor,
} from './data.mjs'

const API = (process.env.SEED_API_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const MAILPIT = (process.env.SEED_MAILPIT_URL ?? 'http://localhost:8025').replace(/\/$/, '')
const CONCURRENCY = 8

const counts = {}
const count = (kind, how) => {
  counts[kind] ??= { created: 0, existing: 0 }
  counts[kind][how]++
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function raw(method, path, body, headers = {}) {
  return fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

class Session {
  constructor(email, displayName) {
    this.email = email
    this.displayName = displayName
    this.token = null
    this.signingIn = null
  }

  /** Signs in, or signs up the first time. The access token lasts 15 minutes, so this also runs again on a 401. */
  signIn() {
    this.signingIn ??= (async () => {
      let res = await raw('POST', '/api/v1/auth/signin', { email: this.email, password: PASSWORD })
      if (res.status === 401 || res.status === 400) {
        res = await raw('POST', '/api/v1/auth/signup', {
          email: this.email,
          password: PASSWORD,
          displayName: this.displayName,
        })
      }
      if (!res.ok) throw new Error(`sign-in of ${this.email} failed: ${res.status} ${await res.text()}`)
      this.token = (await res.json()).accessToken
    })().finally(() => (this.signingIn = null))
    return this.signingIn
  }

  async call(method, path, body, { key, ifMatch } = {}) {
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!this.token) await this.signIn()
      const res = await raw(method, path, body, {
        Authorization: `Bearer ${this.token}`,
        ...(key ? { 'Idempotency-Key': key } : {}),
        ...(ifMatch ? { 'If-Match': ifMatch } : {}),
      })
      if (res.status === 401) {
        this.token = null
        continue
      }
      if (res.status === 429) {
        await sleep((Number(res.headers.get('Retry-After')) || 1) * 1000)
        continue
      }
      if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`)
      return res.status === 204 ? null : res.json()
    }
    throw new Error(`${method} ${path}: gave up after repeated 401 or 429`)
  }
}

/** Runs the items with at most `limit` in flight. */
async function pool(items, limit, worker) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await worker(items[next++])
    }),
  )
}

async function pagedItems(session, path) {
  const out = []
  let cursor
  do {
    const sep = path.includes('?') ? '&' : '?'
    const page = await session.call('GET', `${path}${sep}limit=200${cursor ? `&cursor=${cursor}` : ''}`)
    out.push(...(page.items ?? []))
    cursor = page.nextCursor
  } while (cursor)
  return out
}

// ---- lookups by stable name ----

async function ensureWorkspace(owner) {
  const found = (await pagedItems(owner, '/api/v1/workspaces')).find((w) => w.name === WORKSPACE)
  if (found) {
    count('workspace', 'existing')
    return found.id
  }
  const created = await owner.call('POST', '/api/v1/workspaces', { name: WORKSPACE }, { key: keyFor('workspace') })
  count('workspace', 'created')
  return created.id
}

async function ensureLocation(owner, workspaceId, parentId, type, name) {
  const query = parentId ? `?parentId=${parentId}` : ''
  const tree = await owner.call('GET', `/api/v1/workspaces/${workspaceId}/tree${query}`)
  const found = (tree.items ?? []).find((n) => n.name === name && n.type === type)
  if (found) {
    count(type.toLowerCase(), 'existing')
    return found.id
  }
  const created = await owner.call(
    'POST',
    '/api/v1/locations',
    { type, name, ...(parentId ? { parentId } : { workspaceId }) },
    { key: keyFor('location', workspaceId, parentId ?? 'root', type, name) },
  )
  count(type.toLowerCase(), 'created')
  return created.id
}

async function inviteToken(email) {
  for (let i = 0; i < 100; i++) {
    const query = encodeURIComponent(`to:"${email}"`)
    const search = await (await fetch(`${MAILPIT}/api/v1/search?query=${query}`)).json()
    for (const message of search.messages ?? []) {
      const detail = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()
      const match = /\/invite\/([A-Za-z0-9_-]+)/.exec(detail.Text ?? '')
      if (match) return match[1]
    }
    await sleep(200)
  }
  throw new Error(`no invite mail for ${email} in Mailpit (${MAILPIT})`)
}

async function ensureMembers(owner, workspaceId) {
  const have = new Set((await pagedItems(owner, `/api/v1/workspaces/${workspaceId}/members`)).map((m) => m.email))
  const invites = await owner.call('GET', `/api/v1/workspaces/${workspaceId}/invites`).catch(() => ({}))
  const pending = new Set((invites.items ?? []).map((i) => i.email))
  for (const spec of MEMBERS) {
    if (have.has(spec.email)) {
      count('member', 'existing')
      continue
    }
    const session = new Session(spec.email, spec.displayName)
    await session.signIn()
    if (!pending.has(spec.email)) {
      await owner.call(
        'POST',
        `/api/v1/workspaces/${workspaceId}/invites`,
        { email: spec.email, role: 'MEMBER' },
        { key: keyFor('invite', workspaceId, spec.email) },
      )
    }
    await session.call('POST', `/api/v1/invites/${await inviteToken(spec.email)}/accept`)
    count('member', 'created')
  }
  const members = await pagedItems(owner, `/api/v1/workspaces/${workspaceId}/members`)
  return MEMBERS.map((m) => members.find((f) => f.email === m.email)?.userId).filter(Boolean)
}

/** The custom fields of the first demo Space, created once (found by name); returns their ids. */
async function ensureFields(owner, spaceId) {
  const existing = (await owner.call('GET', `/api/v1/locations/${spaceId}/fields`)).fields ?? []
  const ids = {}
  for (const def of CUSTOM_FIELDS) {
    const found = existing.find((f) => f.name === def.name)
    if (found) {
      count('field', 'existing')
      ids[def.name] = found
      continue
    }
    const created = await owner.call(
      'POST',
      `/api/v1/locations/${spaceId}/fields`,
      { name: def.name, type: def.type, ...(def.options ? { options: def.options.map((name) => ({ name })) } : {}) },
      { key: keyFor('field', spaceId, def.name) },
    )
    count('field', 'created')
    ids[def.name] = created
  }
  return ids
}

/** Sets the demo values on a task that lacks them (found by what the task already carries). */
async function seedValues(owner, task, i, fields) {
  const [points, tier] = [fields['Story points'], fields['Customer tier']]
  const wanted = {}
  const have = task.customFields ?? {}
  const p = storyPointsFor(i)
  if (p !== undefined && have[points.id] === undefined) wanted[points.id] = p
  const t = tierFor(i)
  if (t !== undefined && have[tier.id] === undefined) wanted[tier.id] = t
  if (Object.keys(wanted).length === 0) return count('fieldvalues', 'existing')
  await owner.call('PATCH', `/api/v1/tasks/${task.id}`, { customFields: wanted }, { ifMatch: `"${task.version}"` })
  count('fieldvalues', 'created')
}

// ---- tasks ----

async function seedList(owner, workspaceId, listId, listName, total, memberIds, fields) {
  const statuses = (await owner.call('GET', `/api/v1/locations/${listId}/statuses`)).statuses ?? []
  const existing = new Map((await pagedItems(owner, `/api/v1/tasks?locationId=${listId}`)).map((t) => [t.title, t]))
  let progress = 0
  await pool(Array.from({ length: total }, (_, i) => i), CONCURRENCY, async (i) => {
    const title = taskTitle(listName, i)
    let task = existing.get(title)
    if (task) count('task', 'existing')
    else {
      const a = assigneeIndexFor(i, memberIds.length)
      const due = dueDateFor(i)
      task = await owner.call(
        'POST',
        `/api/v1/lists/${listId}/tasks`,
        {
          title,
          priority: priorityFor(i),
          tags: tagsFor(i),
          statusId: statuses[Math.min(statusIndexFor(i), statuses.length - 1)]?.id,
          ...(a >= 0 ? { assigneeIds: [memberIds[a]] } : {}),
          ...(due ? { dueDate: due } : {}),
        },
        { key: keyFor('task', workspaceId, listId, i) },
      )
      count('task', 'created')
    }
    if (fields) await seedValues(owner, task, i, fields)
    if (hasSubtask(i) && total < 1000) {
      if (existing.has(subtaskTitle(title))) count('subtask', 'existing')
      else {
        await owner.call(
          'POST',
          `/api/v1/lists/${listId}/tasks`,
          { title: subtaskTitle(title), parentTaskId: task.id },
          { key: keyFor('subtask', workspaceId, listId, i) },
        )
        count('subtask', 'created')
      }
    }
    if (hasComment(i) && total < 1000) {
      const text = commentText(title)
      const comments = await pagedItems(owner, `/api/v1/tasks/${task.id}/comments`)
      if (comments.some((c) => textOf(c.body) === text)) count('comment', 'existing')
      else {
        await owner.call('POST', `/api/v1/tasks/${task.id}/comments`, { body: doc(text) }, { key: keyFor('comment', workspaceId, task.id) })
        count('comment', 'created')
      }
    }
    if (++progress % 500 === 0) console.log(`  ${listName}: ${progress}/${total}`)
  })
}

async function main() {
  console.log(`Seeding ${API} (mail: ${MAILPIT})`)
  const owner = new Session(OWNER.email, OWNER.displayName)
  await owner.signIn()
  const workspaceId = await ensureWorkspace(owner)
  const memberIds = await ensureMembers(owner, workspaceId)
  if (memberIds.length === 0) throw new Error('the demo Workspace has no members to assign')

  for (const [n, space] of STRUCTURE.entries()) {
    const spaceId = await ensureLocation(owner, workspaceId, null, 'SPACE', space.space)
    // Custom fields live on the first demo Space and reach every List below it.
    const fields = n === 0 ? await ensureFields(owner, spaceId) : undefined
    for (const list of space.lists) {
      const listId = await ensureLocation(owner, workspaceId, spaceId, 'LIST', list.name)
      await seedList(owner, workspaceId, listId, list.name, list.tasks, memberIds, fields)
    }
    for (const folder of space.folders) {
      const folderId = await ensureLocation(owner, workspaceId, spaceId, 'FOLDER', folder.name)
      for (const list of folder.lists) {
        const listId = await ensureLocation(owner, workspaceId, folderId, 'LIST', list.name)
        await seedList(owner, workspaceId, listId, list.name, list.tasks, memberIds, fields)
      }
    }
  }
  const loadSpace = await ensureLocation(owner, workspaceId, null, 'SPACE', BIG_LIST.space)
  const bigList = await ensureLocation(owner, workspaceId, loadSpace, 'LIST', BIG_LIST.list)
  await seedList(owner, workspaceId, bigList, BIG_LIST.list, BIG_LIST.count, memberIds)

  console.log('\nCreated / already there:')
  for (const [kind, c] of Object.entries(counts)) console.log(`  ${kind.padEnd(10)} ${c.created} / ${c.existing}`)
  console.log(`\nTotal created this run: ${Object.values(counts).reduce((n, c) => n + c.created, 0)}`)
  console.log(`\nSign in (password ${PASSWORD}) as:`)
  console.log(`  ${OWNER.email}   owner of "${WORKSPACE}"`)
  for (const m of MEMBERS) console.log(`  ${m.email}`)
  console.log(`Big List for the k6 script: "${BIG_LIST.space} / ${BIG_LIST.list}" (${BIG_LIST.count} tasks)`)
}

main().catch((error) => {
  console.error(error.message ?? error)
  process.exit(1)
})
