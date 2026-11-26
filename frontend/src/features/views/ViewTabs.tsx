import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { messageOf } from '../../api/errors'
import type { ViewConfig, ViewDto } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'
import { Button } from '../../shared/ui/Button'
import { Checkbox } from '../../shared/ui/Checkbox'
import { Select } from '../../shared/ui/Select'
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
        className="flex flex-wrap items-center gap-1 border-b border-line"
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
                `rounded-t-md px-3 py-1.5 text-[13px] ${isActive || viewKey(current) === key ? 'border-b-2 border-accent font-semibold text-fg' : 'text-muted hover:bg-surface-2'}`
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
          className="ml-1 rounded-md px-2 py-1 text-[13px] text-accent hover:bg-surface-2"
          onClick={() => setCreating(creating === 'new' ? null : 'new')}
        >
          + View
        </button>
        <span className="ml-auto flex gap-2 pb-1">
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
      {dirty && (
        <div
          role="group"
          aria-label="Unsaved view changes"
          className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent-line bg-accent-soft px-3 py-1.5 text-[13px] text-fg"
        >
          <span className="mr-auto font-medium">Unsaved view changes</span>
          <Button variant="primary" disabled={save.isPending} onClick={() => void saveCurrent()}>
            Save view
          </Button>
          <Button onClick={() => setCreating('copy')}>Save as new</Button>
          <Button onClick={clearParams}>Discard</Button>
        </div>
      )}
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
      className="mt-2 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3 text-[13px] text-fg"
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
          className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-fg"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="flex flex-col">
        Type
        <Select
          value={type}
          disabled={lockType}
          onValueChange={(next) => setType(next as ViewType)}
          options={TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
        />
      </label>
      <label className="flex flex-col">
        Who can see it
        <Select
          value={visibility}
          onValueChange={(next) => setVisibility(next as typeof visibility)}
          options={[
            { value: 'SHARED', label: 'Everyone who can see this place' },
            { value: 'PERSONAL', label: 'Only me' },
            { value: 'PRIVATE', label: 'Me and people I choose' },
          ]}
        />
      </label>
      {visibility === 'PRIVATE' && (
        <fieldset className="flex flex-wrap gap-2">
          <legend>Share with</legend>
          {members.map((m) => (
            <Checkbox
              key={m.userId}
              label={m.displayName ?? m.email ?? ''}
              checked={shareWith.includes(m.userId!)}
              onCheckedChange={(checked) =>
                setShareWith(
                  checked ? [...shareWith, m.userId!] : shareWith.filter((id) => id !== m.userId),
                )
              }
            />
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
