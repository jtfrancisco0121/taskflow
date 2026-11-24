import { json, problem, type StubHandler } from './api'

export type SimStatus = { id: string; name: string; group: string; color: string }

/**
 * A strict in-memory copy of the backend's status rules (`StatusService`): a draft id must belong
 * to the location's own set, every removed status of the previous *effective* set needs a remap
 * target given by NAME, and a remap for a status that is not removed is refused. A request that
 * breaks the contract gets the server's 400/409 code, so a wrong body fails the test.
 */
export function createStatusSim(config: {
  parents: Record<string, string | null>
  types: Record<string, 'SPACE' | 'FOLDER' | 'LIST'>
  own: Record<string, SimStatus[]>
}) {
  const own = structuredClone(config.own)
  let seq = 0
  const log: { method: string; location: string; body: unknown }[] = []

  function effective(location: string): { definedAt: string | null; statuses: SimStatus[] } {
    let at: string | null | undefined = location
    while (at) {
      if (own[at]?.length) return { definedAt: at, statuses: own[at] }
      at = config.parents[at]
    }
    return { definedAt: null, statuses: [] }
  }

  function view(location: string) {
    const { definedAt, statuses } = effective(location)
    return {
      locationId: location,
      definedAt,
      inheritedFrom: definedAt === location ? null : definedAt,
      statuses: statuses.map((s) => ({ ...s, definedAt })),
    }
  }

  function resolve(
    removed: SimStatus[],
    remap: { from: string; to: string }[],
    targets: Map<string, string>,
  ): Response | null {
    const requested = new Map(remap.map((r) => [r.from, r.to]))
    for (const status of removed) {
      const to = requested.get(status.id)
      if (to === undefined) {
        return problem(
          400,
          'status.remap_required',
          `Removed status ${status.id} needs a remap target`,
        )
      }
      if (!targets.has(to.trim().toLowerCase())) {
        return problem(
          400,
          'status.remap_target_unknown',
          `Remap target '${to}' is not in the new set`,
        )
      }
    }
    for (const from of requested.keys()) {
      if (!removed.some((s) => s.id === from)) {
        return problem(400, 'status.remap_not_removed', `Status ${from} is not being removed`)
      }
    }
    return null
  }

  const idOf = (request: Request, fromEnd = 2) =>
    new URL(request.url).pathname.split('/').at(-fromEnd)!

  const handlers: Record<string, StubHandler> = {
    'GET /api/v1/locations/:id/statuses': (request) => json(view(idOf(request))),
    'PUT /api/v1/locations/:id/statuses': (request, body) => {
      const loc = idOf(request)
      log.push({ method: 'PUT', location: loc, body })
      const b = body as {
        statuses: { id?: string; name: string; group: string; color?: string }[]
        remap?: { from: string; to: string }[]
      }
      const before = effective(loc).statuses
      const ownIds = new Set((own[loc] ?? []).map((s) => s.id))
      for (const d of b.statuses) {
        if (d.id && !ownIds.has(d.id)) {
          return problem(
            400,
            'status.unknown_id',
            `Status ${d.id} is not part of this location's own set`,
          )
        }
      }
      const names = new Set<string>()
      for (const d of b.statuses) {
        const n = d.name.trim().toLowerCase()
        if (!n || n.length > 50)
          return problem(400, 'status.invalid_name', 'Status names are 1 to 50 characters')
        if (names.has(n))
          return problem(400, 'status.duplicate_name', 'Status names must be unique within a set')
        names.add(n)
      }
      const kept = new Set(b.statuses.flatMap((d) => (d.id ? [d.id] : [])))
      const removed = before.filter((s) => !kept.has(s.id))
      const next: SimStatus[] = b.statuses.map((d) => ({
        id: d.id ?? `new-${++seq}`,
        name: d.name.trim(),
        group: d.group,
        color: d.color ?? '#9ca3af',
      }))
      const error = resolve(
        removed,
        b.remap ?? [],
        new Map(next.map((s) => [s.name.toLowerCase(), s.id])),
      )
      if (error) return error
      own[loc] = next
      return json(view(loc))
    },
    'DELETE /api/v1/locations/:id/statuses': (request, body) => {
      const loc = idOf(request)
      log.push({ method: 'DELETE', location: loc, body })
      if (config.types[loc] === 'SPACE')
        return problem(409, 'status.space_needs_set', 'A Space defines its own statuses')
      const mine = own[loc] ?? []
      if (!mine.length)
        return problem(409, 'status.not_overridden', 'This location already inherits its statuses')
      const parent = config.parents[loc]
      const inherited = parent ? effective(parent).statuses : []
      const error = resolve(
        mine,
        (body as { remap?: { from: string; to: string }[] })?.remap ?? [],
        new Map(inherited.map((s) => [s.name.toLowerCase(), s.id])),
      )
      if (error) return error
      own[loc] = []
      return json(view(loc))
    },
  }

  return { handlers, log, own, effective }
}
