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
export type ViewConfig = components['schemas']['ViewConfig']
export type ViewFilter = components['schemas']['Filter']
export type ViewDto = components['schemas']['ViewDto']
export type ViewQueryResponse = components['schemas']['QueryResponse']
export type ViewItem = components['schemas']['ViewItem']
export type GroupInfo = components['schemas']['GroupInfo']
export type SearchHit = components['schemas']['SearchHit']
export type MoveTaskBody = components['schemas']['MoveTaskRequest']
export type ServiceAccountView = components['schemas']['ServiceAccountView']
export type ApiKeyView = components['schemas']['ApiKeyView']
export type CreatedApiKey = components['schemas']['CreatedApiKey']
export type ServiceAccountAudit = components['schemas']['Audit']
export type AccountActivity = components['schemas']['AccountActivity']
