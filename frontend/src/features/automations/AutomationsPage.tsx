import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { messageOf } from '../../api/errors'
import type { RuleView } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { useToastStore } from '../../shared/toast-store'
import { useLocationFields } from '../fields'
import { useLocationInfo } from '../locations'
import { useMembers } from '../workspace'
import { RuleBuilder } from './RuleBuilder'
import { RuleCard } from './RuleCard'
import { useAutomations, useDeleteAutomation, useToggleAutomation } from './useAutomations'

/** `/w/:ws/l/:loc/automations`: the rules of a Location, own and inherited (CAP-8). */
export function AutomationsPage() {
  const { workspaceId = '', locationId = '' } = useParams()
  const location = useLocationInfo(locationId)
  const list = useAutomations(locationId)
  const { members } = useMembers(workspaceId)
  const fields = useLocationFields(locationId)
  const toggle = useToggleAutomation(locationId)
  const remove = useDeleteAutomation()
  const toast = useToastStore((s) => s.show)
  const [builder, setBuilder] = useState<{ rule?: RuleView } | null>(null)
  const [confirm, setConfirm] = useState<RuleView | null>(null)
  const newButton = useRef<HTMLButtonElement>(null)

  const names = {
    person: (id: string) => members.find((m) => m.userId === id)?.displayName ?? 'someone',
    field: (id: string) => fields.data?.fields?.find((f) => f.id === id)?.name ?? 'a field',
  }

  if (list.isError || location.isError) {
    const status = (list.error as { status?: number } | null)?.status
    return (
      <section aria-label="Automations">
        <p role="alert" className="text-red-700">
          {status === 404
            ? "This location doesn't exist or you don't have access."
            : messageOf(list.error ?? location.error)}
        </p>
        <Link to={`/w/${workspaceId}`} className="text-blue-700 underline">
          Back to the Workspace
        </Link>
      </section>
    )
  }

  const canEdit = list.data?.canEdit ?? false
  const rules = list.data?.rules ?? []
  const atLimit = rules.filter((r) => !r.inherited).length >= (list.data?.limit ?? 50)

  function onToggle(rule: RuleView, enabled: boolean) {
    toggle.mutate(
      { id: rule.id!, version: rule.version ?? 0, enabled },
      { onError: (e) => toast(messageOf(e), 'error') },
    )
  }

  return (
    <section aria-label="Automations">
      <header className="mb-3 flex items-center gap-2">
        <h1 className="text-2xl font-semibold">Automations</h1>
        <span className="text-sm text-slate-500">{location.data?.name}</span>
        <Link
          to={`/w/${workspaceId}/l/${locationId}`}
          className="ml-auto text-sm text-blue-700 underline"
        >
          Back to {location.data?.name ?? 'the location'}
        </Link>
        {canEdit && (
          <Button
            ref={newButton}
            variant="primary"
            disabled={atLimit}
            onClick={() => setBuilder({})}
          >
            New rule
          </Button>
        )}
      </header>
      {atLimit && canEdit && (
        <p className="mb-2 text-sm text-amber-800">
          This location has reached its limit of {list.data?.limit} rules. Delete one to add more.
        </p>
      )}
      {list.isPending && <p role="status">Loading…</p>}
      {list.isSuccess && !canEdit && (
        <p className="mb-3 text-sm text-slate-600">
          You can view rules here. Ask an editor to change them.
        </p>
      )}
      {list.isSuccess && rules.length === 0 && (
        <div>
          <p className="font-medium">No rules here yet</p>
          {canEdit && (
            <p className="text-sm text-slate-600">
              A rule runs actions when something happens to a task in this location.
            </p>
          )}
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {rules.map((rule) => (
          <li key={rule.id}>
            <RuleCard
              rule={rule}
              names={names}
              canEdit={canEdit && !rule.inherited}
              onToggle={(enabled) => onToggle(rule, enabled)}
              onEdit={() => setBuilder({ rule })}
              onDelete={() => setConfirm(rule)}
            />
          </li>
        ))}
      </ul>
      {builder && (
        <RuleBuilder
          workspaceId={workspaceId}
          locationId={locationId}
          rule={builder.rule}
          onClose={() => setBuilder(null)}
          restoreFocus={() => newButton.current}
        />
      )}
      {confirm && (
        <Dialog title="Delete rule" onClose={() => setConfirm(null)}>
          <p className="mb-4 text-sm">
            Delete &ldquo;{confirm.name}&rdquo;? It stops running. Its run history is kept.
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(
                  { id: confirm.id!, version: confirm.version ?? 0 },
                  {
                    onSuccess: () => setConfirm(null),
                    onError: (e) => {
                      setConfirm(null)
                      toast(messageOf(e), 'error')
                    },
                  },
                )
              }
            >
              Delete
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  )
}
