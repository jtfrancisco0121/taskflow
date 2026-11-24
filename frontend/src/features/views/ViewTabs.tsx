import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { messageOf } from '../../api/errors'
import type { ViewConfig, ViewDto } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'
import { Button } from '../../shared/ui/Button'
import { useMembers } from '../workspace'
import { viewPath, type ViewScope } from './scope'
import { useDeleteView, useSaveView, viewKey } from './useViews'

const TYPES = ['LIST', 'BOARD', 'TABLE', 'CALENDAR'] as const
type ViewType = (typeof TYPES)[number]
const TYPE_LABEL: Record<ViewType, string> = {
  LIST: 'List',
  BOARD: 'Board',
  TABLE: 'Table',
  CALENDAR: 'Calendar',
}

/**
 * VIEW-2: the Default List and Board first, then the saved views, "+ View", and Save / Save as new
 * when the URL differs from the saved config. Saving a Default view posts `defaultKind`.
 */
export function ViewTabs({
  scope,
  views,
  current,
  config,
  dirty,
  clearParams,
}: {
  scope: ViewScope
  views: ViewDto[]
  current: ViewDto
  /** The effective config (saved config with the URL laid over it). */
  config: ViewConfig
  dirty: boolean
  clearParams: () => void
}) {
  const navigate = useNavigate()
  const save = useSaveView(scope)
  const remove = useDeleteView(scope)
  const show = useToastStore((s) => s.show)
  const [creating, setCreating] = useState<null | 'new' | 'copy'>(null)

  async function saveCurrent() {
    try {
      await save.mutateAsync({ mode: 'update', view: current, config })
      clearParams()
      show('View saved.')
    } catch (e) {
      show(messageOf(e), 'error')
    }
  }

  async function create(input: {
    name: string
    type: ViewType
    visibility: 'SHARED' | 'PERSONAL' | 'PRIVATE'
    shareWith: string[]
  }) {
    try {
      const view = await save.mutateAsync({
        mode: 'create',
        ...input,
        config:
          creating === 'copy'
            ? config
            : { v: 1, ...(input.type === 'BOARD' ? { group: 'status' } : {}) },
      })
      setCreating(null)
      void navigate(viewPath(scope, view.id ?? ''))
    } catch (e) {
      show(messageOf(e), 'error')
    }
  }

  return (
    <div className="mb-3">
      <div
        role="tablist"
        aria-label="Views"
        className="flex flex-wrap items-center gap-1 border-b border-slate-200"
      >
        {views.map((view) => {
          const key = viewKey(view)
          return (
            <NavLink
              key={key}
              role="tab"
              to={viewPath(scope, key)}
              aria-selected={viewKey(current) === key}
              className={({ isActive }) =>
                `rounded-t px-3 py-1.5 text-sm ${isActive || viewKey(current) === key ? 'border-b-2 border-blue-600 font-semibold' : 'text-slate-600 hover:bg-slate-100'}`
              }
            >
              {view.name}
              {view.visibility === 'PERSONAL' && <span title="Only you"> 🔒</span>}
              {view.visibility === 'PRIVATE' && <span title="Shared with some people"> 👥</span>}
            </NavLink>
          )
        })}
        <button
          type="button"
          className="ml-1 rounded px-2 py-1 text-sm text-blue-700 hover:bg-slate-100"
          onClick={() => setCreating(creating === 'new' ? null : 'new')}
        >
          + View
        </button>
        <span className="ml-auto flex gap-2 pb-1">
          {dirty && (
            <>
              <Button
                variant="primary"
                disabled={save.isPending}
                onClick={() => void saveCurrent()}
              >
                Save view
              </Button>
              <Button onClick={() => setCreating('copy')}>Save as new</Button>
              <Button onClick={clearParams}>Discard</Button>
            </>
          )}
          {current.id && !current.defaultKind && (
            <Button
              onClick={() =>
                void remove
                  .mutateAsync(current)
                  .then(() => navigate(viewPath(scope, 'default-list')))
                  .catch((e: unknown) => show(messageOf(e), 'error'))
              }
            >
              Delete view
            </Button>
          )}
        </span>
      </div>
      {creating && (
        <NewViewForm
          scope={scope}
          initialType={creating === 'copy' ? ((current.type as ViewType) ?? 'LIST') : 'LIST'}
          lockType={creating === 'copy'}
          onSubmit={(input) => void create(input)}
          onCancel={() => setCreating(null)}
          busy={save.isPending}
        />
      )}
    </div>
  )
}

function NewViewForm({
  scope,
  initialType,
  lockType,
  onSubmit,
  onCancel,
  busy,
}: {
  scope: ViewScope
  initialType: ViewType
  lockType: boolean
  onSubmit: (input: {
    name: string
    type: ViewType
    visibility: 'SHARED' | 'PERSONAL' | 'PRIVATE'
    shareWith: string[]
  }) => void
  onCancel: () => void
  busy: boolean
}) {
  const { members } = useMembers(scope.workspaceId)
  const [name, setName] = useState('')
  const [type, setType] = useState<ViewType>(initialType)
  const [visibility, setVisibility] = useState<'SHARED' | 'PERSONAL' | 'PRIVATE'>('SHARED')
  const [shareWith, setShareWith] = useState<string[]>([])
  return (
    <form
      aria-label="New view"
      className="mt-2 flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) onSubmit({ name: name.trim(), type, visibility, shareWith })
      }}
    >
      <label className="flex flex-col">
        View name
        <input
          autoFocus
          value={name}
          className="rounded border border-slate-300 px-1"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="flex flex-col">
        Type
        <select
          value={type}
          disabled={lockType}
          onChange={(e) => setType(e.target.value as ViewType)}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col">
        Who can see it
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as typeof visibility)}
        >
          <option value="SHARED">Everyone who can see this place</option>
          <option value="PERSONAL">Only me</option>
          <option value="PRIVATE">Me and people I choose</option>
        </select>
      </label>
      {visibility === 'PRIVATE' && (
        <fieldset className="flex flex-wrap gap-2">
          <legend>Share with</legend>
          {members.map((m) => (
            <label key={m.userId} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={shareWith.includes(m.userId!)}
                onChange={(e) =>
                  setShareWith(
                    e.target.checked
                      ? [...shareWith, m.userId!]
                      : shareWith.filter((id) => id !== m.userId),
                  )
                }
              />
              {m.displayName ?? m.email}
            </label>
          ))}
        </fieldset>
      )}
      <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
        Create view
      </Button>
      <Button onClick={onCancel}>Cancel</Button>
    </form>
  )
}
