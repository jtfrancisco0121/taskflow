// Deterministic demo data: the same index always gives the same task, so a re-run finds what a
// previous run created by its title (AD-21). No randomness, no clock.

export const OWNER = { email: 'demo-owner@example.com', displayName: 'Dana Demo' }
export const PASSWORD = 'demo-password-2026'
export const MEMBERS = [
  { email: 'demo-ana@example.com', displayName: 'Ana Silva' },
  { email: 'demo-ben@example.com', displayName: 'Ben Okafor' },
  { email: 'demo-chloe@example.com', displayName: 'Chloe Martin' },
]

export const WORKSPACE = 'Demo'
export const BIG_LIST = { space: 'Load Test', list: 'Load 5000', count: 5000 }

/** Spaces with their Folders and Lists; every task list gets `tasks` tasks. */
export const STRUCTURE = [
  {
    space: 'Product',
    lists: [{ name: 'Backlog', tasks: 40 }],
    folders: [
      {
        name: 'Roadmap',
        lists: [
          { name: 'Q1 launch', tasks: 40 },
          { name: 'Q2 ideas', tasks: 25 },
        ],
      },
    ],
  },
  {
    space: 'Engineering',
    lists: [{ name: 'Bugs', tasks: 45 }],
    folders: [
      {
        name: 'Sprints',
        lists: [
          { name: 'Sprint 12', tasks: 50 },
          { name: 'Sprint 13', tasks: 30 },
        ],
      },
    ],
  },
  {
    space: 'Marketing',
    lists: [{ name: 'Campaigns', tasks: 35 }],
    folders: [{ name: 'Content', lists: [{ name: 'Blog posts', tasks: 30 }] }],
  },
]

const PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'NORMAL', 'LOW', 'NONE']
const TAGS = ['bug', 'feature', 'design', 'docs', 'customer', 'infra']
const VERBS = ['Draft', 'Review', 'Ship', 'Plan', 'Fix', 'Refine', 'Test', 'Document']
const NOUNS = [
  'onboarding flow',
  'pricing page',
  'export job',
  'search index',
  'login form',
  'weekly report',
  'API limits',
  'billing email',
]

export const taskTitle = (listName, i) =>
  `${VERBS[i % VERBS.length]} ${NOUNS[(i * 3) % NOUNS.length]} (${listName} #${i + 1})`

export const subtaskTitle = (parentTitle) => `${parentTitle} - checklist`

export const priorityFor = (i) => PRIORITIES[i % PRIORITIES.length]

export const tagsFor = (i) =>
  i % 3 === 0 ? [TAGS[i % TAGS.length]] : i % 5 === 0 ? [TAGS[(i + 2) % TAGS.length], 'customer'] : []

/** Which member (by index) is assigned; -1 means nobody. */
export const assigneeIndexFor = (i, memberCount) => (i % 4 === 3 ? -1 : i % memberCount)

/** A due date as a UTC midnight instant around a base day; every 6th task has none. */
export function dueDateFor(i, base = '2026-11-24') {
  if (i % 6 === 5) return undefined
  const day = new Date(`${base}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + ((i * 7) % 45) - 10)
  return day.toISOString().replace('.000Z', 'Z')
}

/** Index into the List's status set (0 = to do, 1 = in progress, 2 = complete). */
export const statusIndexFor = (i) => [0, 0, 1, 0, 2, 1, 0, 1][i % 8]

export const hasSubtask = (i) => i % 10 === 0
export const hasComment = (i) => i % 7 === 0
export const commentText = (title) => `Kickoff note: ${title}`

/** A Tiptap document with one paragraph. */
export const doc = (text) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

export const textOf = (docNode) =>
  (docNode?.content ?? [])
    .flatMap((p) => p.content ?? [])
    .map((n) => n.text ?? '')
    .join('')

/** Stable idempotency key: the same entity always sends the same key (a retry guard only). */
export const keyFor = (...parts) => `seed:${parts.join(':')}`

// ---- custom fields (3A): defined on the first demo Space, values on its seeded tasks ----

/** Custom fields of the first demo Space; found again by name on a re-run. */
export const CUSTOM_FIELDS = [
  { name: 'Story points', type: 'NUMBER' },
  { name: 'Customer tier', type: 'DROPDOWN', options: ['Free', 'Pro', 'Enterprise'] },
]

/** Story points of the i-th task; every 5th task has none. */
export const storyPointsFor = (i) => (i % 5 === 4 ? undefined : [1, 2, 3, 5, 8, 13][i % 6])

/** Customer tier (an Option name) of the i-th task; every 4th task has none. */
export const tierFor = (i) => (i % 4 === 3 ? undefined : CUSTOM_FIELDS[1].options[i % 3])

/** The field of the big List's Space, for the load test: a custom field filter and sort (SM-2). */
export const LOAD_FIELD = { name: 'Load score', type: 'NUMBER' }

/** Load score of the i-th task of the big List; every 10th task has none. */
export const loadScoreFor = (i) => (i % 10 === 9 ? undefined : (i * 37) % 1000)
