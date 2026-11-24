import type { components } from './schema'

/** Aliases of the generated schema; never hand-write an API shape. */
export type TaskView = components['schemas']['TaskView']
export type StatusInfo = components['schemas']['StatusInfo']
export type StatusSetView = components['schemas']['StatusSetView']
export type LocationView = components['schemas']['LocationView']
export type MemberView = components['schemas']['MemberView']
export type CommentView = components['schemas']['CommentView']
export type ActivityView = components['schemas']['ActivityView']
export type Priority = NonNullable<TaskView['priority']>
