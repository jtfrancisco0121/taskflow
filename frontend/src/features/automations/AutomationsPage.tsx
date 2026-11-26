import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { messageOf } from '../../api/errors'
import type { RuleView } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { EmptyState } from '../../shared/ui/EmptyState'
import { ErrorState } from '../../shared/ui/ErrorState'
import { PageHeader } from '../../shared/ui/PageHeader'
import { Skeleton } from '../../shared/ui/Skeleton'
import { useToastStore } from '../../shared/toast-store'
import { useLocationFields } from '../fields'
import { useLocationInfo } from '../locations'
import { useMembers } from '../workspace'
import { RuleBuilder } from './RuleBuilder'
import { RuleCard } from './RuleCard'
import { RunsSheet } from './RunsSheet'
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
  const [history, setHistory] = useState<RuleView | null>(null)
  const newButton = useRef<HTMLButtonElement>(null)

  const names = {
    person: (id: string) => members.find((m) => m.userId === id)?.displayName ?? 'someone',
    field: (id: string) => fields.data?.fields?.find((f) => f.id === id)?.name ?? 'a field',
  }

  if (list.isError || location.isError) {
    const status = (list.error as { status?: number } | null)?.status
    const message =
      status === 404
        ? "This location doesn't exist or you don't have access."
        : messageOf(list.error ?? location.error)
    return (
      <section aria-label="Automations" className="flex flex-col gap-3">
        <PageHeader title="Automations" />
        <ErrorState
          message={message}
          onRetry={
            status === 404
              ? undefined
              : () => {
                  void list.refetch()
                  void location.refetch()
                }
          }
        />
        <Link to={`/w/${workspaceId}`} className="text-sm text-accent underline">
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
      <PageHeader title="Automations">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">{location.data?.name}</span>
          <Link to={`/w/${workspaceId}/l/${locationId}`} className="text-sm text-accent underline">
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
        </div>
      </PageHeader>
      {atLimit && canEdit && (
        <p className="mb-2 text-sm text-fg">
          This location has reached its limit of {list.data?.limit} rules. Delete one to add more.
        </p>
      )}
      {list.isPending && (
        <div role="status" aria-label="Loading automations" className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}
      {list.isSuccess && !canEdit && (
        <p className="mb-3 text-sm text-muted">
          You can view rules here. Ask an editor to change them.
        </p>
      )}
      {list.isSuccess && rules.length === 0 && (
        <EmptyState
          title="No rules here yet"
          description={
            canEdit
              ? 'A rule runs actions when something happens to a task in this location.'
              : undefined
          }
        />
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
              onHistory={() => setHistory(rule)}
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
      {history && <RunsSheet rule={history} onClose={() => setHistory(null)} />}
      {confirm && (
        <Dialog title="Delete rule" onClose={() => setConfirm(null)}>
          <p className="mb-4 text-sm text-fg">
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
