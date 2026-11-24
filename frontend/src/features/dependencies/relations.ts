import type { DependencyRelation } from '../../api/types'

/** The relation as the acting task sees it (relationship-rules.md). */
export const RELATION_LABEL: Record<DependencyRelation, string> = {
  WAITING_ON: 'Waiting on',
  BLOCKING: 'Blocking',
  LINKED: 'Linked',
}

export const RELATIONS: DependencyRelation[] = ['WAITING_ON', 'BLOCKING', 'LINKED']

/** "1 task" / "3 tasks". */
export function tasksOf(count: number): string {
  return `${count} ${count === 1 ? 'task' : 'tasks'}`
}
