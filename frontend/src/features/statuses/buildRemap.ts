import type { StatusInfo } from '../../api/types'
import type { DraftRow } from './statusTypes'

/** A status that can receive tasks: a draft of the new set, or a status of the inherited set. */
export type Target = { key: string; name: string }

const norm = (name: string) => name.trim().toLowerCase()

/**
 * Statuses of the previous effective set that the new own set drops. The server treats as removed
 * every status of the previous *effective* set whose id no draft keeps, and a draft id must belong
 * to the location's own set, so a first own set on an inheriting Folder/List (drafts without ids)
 * removes every inherited status.
 */
export function removedStatuses(
  current: StatusInfo[],
  drafts: DraftRow[],
  inheriting: boolean,
): StatusInfo[] {
  if (inheriting) return current
  const kept = new Set(drafts.flatMap((draft) => (draft.id ? [draft.id] : [])))
  return current.filter((status) => !kept.has(status.id ?? ''))
}

export function draftTargets(drafts: DraftRow[]): Target[] {
  return drafts.map((draft) => ({ key: draft.key, name: draft.name }))
}

export type Resolution = {
  /** `remap` entries for every removed status that has a target; `to` is a status NAME. */
  remap: { from: string; to: string }[]
  /** Removed statuses with no same-name target: the user must choose one. */
  needsChoice: StatusInfo[]
  /** Removed statuses still without a target (a choice is missing or no longer valid). */
  unresolved: StatusInfo[]
  /** The target each removed status ended up with (by status id). */
  chosen: Record<string, Target | undefined>
}

/**
 * Pairs every removed status with a target: the same-name target when there is one (matched
 * trimmed and case-insensitively against the target's current name), else the user's choice.
 * `choices` maps a removed status id to a target key.
 */
export function resolveRemap(
  removed: StatusInfo[],
  targets: Target[],
  choices: Record<string, string>,
): Resolution {
  const remap: { from: string; to: string }[] = []
  const needsChoice: StatusInfo[] = []
  const unresolved: StatusInfo[] = []
  const chosen: Record<string, Target | undefined> = {}
  for (const status of removed) {
    const id = status.id ?? ''
    const sameName = targets.find((target) => norm(target.name) === norm(status.name ?? ''))
    if (!sameName) needsChoice.push(status)
    const target = sameName ?? targets.find((candidate) => candidate.key === choices[id])
    chosen[id] = target
    if (target) remap.push({ from: id, to: target.name.trim() })
    else unresolved.push(status)
  }
  return { remap, needsChoice, unresolved, chosen }
}
