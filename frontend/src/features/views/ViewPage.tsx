import { matchPath, useNavigate, useParams } from 'react-router'
import { messageOf } from '../../api/errors'
import type { ViewDto } from '../../api/types'
import { useState, useRef } from 'react'
import { Link } from 'react-router'
import { Button } from '../../shared/ui/Button'
import { useLocationInfo } from '../locations'
import { StatusesDialog } from '../statuses'
import { QuickAdd } from '../tasks'
import { BoardRenderer } from './BoardRenderer'
import { CalendarRenderer } from './CalendarRenderer'
import { ListRenderer } from './ListRenderer'
import { TableRenderer } from './TableRenderer'
import { DEFAULT_LIST_ID, type ViewScope } from './scope'
import { useViewState } from './useViewState'
import { ViewParamsContext } from './viewParams'
import { useViews, viewKey } from './useViews'
import { ViewTabs } from './ViewTabs'
import { ViewToolbar } from './ViewToolbar'

const TYPE_NAME = { SPACE: 'Space', FOLDER: 'Folder', LIST: 'List' } as const
const EMPTY_BASE = { v: 1 }

/** `/w/:ws/l/:loc[/v/:viewId]` and `/w/:ws/v/:viewId`: tabs, toolbar and the view's renderer. */
export function ViewPage({
  scope,
  viewId,
  focusQuickAdd = true,
}: {
  scope: ViewScope
  viewId?: string
  focusQuickAdd?: boolean
}) {
  const location = useLocationInfo(scope.locationId)
  const views = useViews(scope)
  const key = viewId ?? DEFAULT_LIST_ID
  const current = views.data?.find((v) => viewKey(v) === key)
  const statusesButton = useRef<HTMLButtonElement>(null)
  const [statusesOpen, setStatusesOpen] = useState(false)

  if (scope.locationId && location.isError) {
    return (
      <div>
        <p>This location doesn&apos;t exist or you don&apos;t have access.</p>
        <Link to={`/w/${scope.workspaceId}`} className="text-blue-700 underline">
          Back to the Workspace
        </Link>
      </div>
    )
  }
  const type = location.data?.type
  const heading = scope.locationId ? (location.data?.name ?? '') : 'Workspace'

  return (
    <section aria-label="View">
      <header className="mb-3 flex items-center gap-2">
        <h1 className="text-2xl font-semibold">{heading}</h1>
        {location.data?.isPrivate && (
          <span role="img" aria-label="Private" title="Private">
            🔒
          </span>
        )}
        {type && <span className="text-sm text-slate-500">{TYPE_NAME[type]}</span>}
        {location.data && type && scope.locationId && (
          <Link
            to={`/w/${scope.workspaceId}/l/${scope.locationId}/automations`}
            className="ml-auto rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-100"
          >
            Automations
          </Link>
        )}
        {location.data && type && (
          <Button ref={statusesButton} onClick={() => setStatusesOpen(true)}>
            Statuses
          </Button>
        )}
      </header>
      {views.isError && (
        <p role="alert" className="text-red-700">
          {messageOf(views.error)}
        </p>
      )}
      {views.isSuccess && !current && <p>This view doesn&apos;t exist or you can&apos;t see it.</p>}
      {views.isSuccess && current && (
        <ViewBody
          scope={scope}
          views={views.data}
          current={current}
          emptyText={
            current.type === 'LIST' && (type === 'LIST' || !type)
              ? 'No tasks yet. Type a title below to add one.'
              : type
                ? `No tasks in this ${TYPE_NAME[type]} yet.`
                : 'No tasks yet.'
          }
        />
      )}
      {statusesOpen && location.data && type && scope.locationId && (
        <StatusesDialog
          workspaceId={scope.workspaceId}
          location={{
            id: scope.locationId,
            name: location.data.name ?? '',
            type,
            parentId: location.data.parentId,
          }}
          onClose={() => setStatusesOpen(false)}
          restoreFocus={() => statusesButton.current}
        />
      )}
      {type === 'LIST' && current?.type === 'LIST' && scope.locationId && (
        <QuickAdd
          workspaceId={scope.workspaceId}
          listId={scope.locationId}
          autoFocus={focusQuickAdd}
        />
      )}
    </section>
  )
}

function ViewBody({
  scope,
  views,
  current,
  emptyText,
}: {
  scope: ViewScope
  views: ViewDto[]
  current: ViewDto
  emptyText: string
}) {
  const base = current.config ?? EMPTY_BASE
  const state = useViewState(base)
  const { config } = state
  return (
    <>
      <ViewTabs
        scope={scope}
        views={views}
        current={current}
        config={config}
        dirty={state.dirty}
        clearParams={state.reset}
      />
      <ViewToolbar
        scope={scope}
        config={config}
        update={state.update}
        showGrouping={current.type !== 'TABLE' && current.type !== 'CALENDAR'}
        customGroups={current.type !== 'BOARD'}
      />
      {current.type === 'BOARD' && (
        <BoardRenderer scope={scope} config={config} update={state.update} />
      )}
      {current.type === 'TABLE' && (
        <TableRenderer scope={scope} config={config} update={state.update} />
      )}
      {current.type === 'CALENDAR' && (
        <CalendarRenderer scope={scope} config={config} update={state.update} />
      )}
      {(current.type === 'LIST' || !current.type) && (
        <ListRenderer scope={scope} config={config} empty={emptyText} update={state.update} />
      )}
    </>
  )
}

/** Route element for `/w/:workspaceId/l/:locationId` and its `/v/:viewId` form. */
export function LocationViewRoute({ focusQuickAdd = true }: { focusQuickAdd?: boolean }) {
  const { workspaceId, locationId, viewId } = useParams()
  return (
    <ViewPage
      key={`${locationId}`}
      scope={{ workspaceId: workspaceId!, locationId }}
      viewId={viewId}
      focusQuickAdd={focusQuickAdd}
    />
  )
}

/** Route element for `/w/:workspaceId/v/:viewId`. */
export function WorkspaceViewRoute() {
  const { workspaceId, viewId } = useParams()
  return <ViewPage scope={{ workspaceId: workspaceId! }} viewId={viewId} />
}

/** The view drawn behind the Task panel for the place the user came from (AD-3). */
export function ViewBackground({ location }: { location: { pathname: string; search?: string } }) {
  const navigate = useNavigate()
  const path = location.pathname
  const match =
    matchPath('/w/:workspaceId/l/:locationId/v/:viewId', path) ??
    matchPath('/w/:workspaceId/l/:locationId', path) ??
    matchPath('/w/:workspaceId/v/:viewId', path) ??
    matchPath('/w/:workspaceId', path)
  if (!match) return null
  const p = match.params as { workspaceId: string; locationId?: string; viewId?: string }
  return (
    <ViewParamsContext.Provider
      value={{
        search: location.search ?? '',
        set: (next) => void navigate({ pathname: path, search: next.toString() }),
      }}
    >
      <ViewPage
        key={p.locationId ?? 'workspace'}
        scope={{ workspaceId: p.workspaceId, locationId: p.locationId }}
        viewId={p.viewId}
        focusQuickAdd={false}
      />
    </ViewParamsContext.Provider>
  )
}
