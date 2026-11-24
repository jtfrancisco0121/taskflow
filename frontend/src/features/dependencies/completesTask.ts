type Group = string | null | undefined

const FINISHED = new Set(['DONE', 'CLOSED'])

/** True when the status change takes an unfinished task into DONE or CLOSED. */
export function completesTask(from: Group, to: Group): boolean {
  return !!to && FINISHED.has(to) && !(from && FINISHED.has(from))
}
