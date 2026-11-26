import type { RuleView } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { Switch } from '../../shared/ui/Switch'
import { describeAction, describeCondition, describeTrigger } from './ruleText'

type Props = {
  rule: RuleView
  names: { person: (id: string) => string; field: (id: string) => string }
  canEdit: boolean
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onHistory?: () => void
}

const RUN_STYLE: Record<string, string> = {
  SUCCEEDED: 'bg-ok-soft text-fg',
  SKIPPED: 'bg-surface-3 text-muted',
  FAILED: 'bg-danger-soft text-fg',
}

/** One rule: its sentence, an enable switch (editors only), the last run and Edit / Delete. */
export function RuleCard({ rule, names, canEdit, onToggle, onEdit, onDelete, onHistory }: Props) {
  const last = rule.lastRun
  return (
    <article
      aria-label={rule.name}
      className="rounded-lg border border-line bg-surface p-3"
      data-enabled={rule.enabled}
    >
      <div className="flex items-center gap-2">
        <h2 className="font-display font-semibold">{rule.name}</h2>
        {rule.inherited && (
          <span className="rounded-sm bg-surface-3 px-1.5 py-0.5 text-xs text-muted">
            From {rule.definedAtName}
          </span>
        )}
        {!rule.enabled && (
          <span className="rounded-sm bg-warn-soft px-1.5 py-0.5 text-xs text-fg">Off</span>
        )}
        {last && (
          <span
            className={`rounded-sm px-1.5 py-0.5 text-xs ${RUN_STYLE[last.status ?? ''] ?? ''}`}
            title={last.reason ?? undefined}
          >
            Last run: {(last.status ?? '').toLowerCase()}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {onHistory && <Button onClick={onHistory}>History</Button>}
          {canEdit && (
            <>
              <Switch
                checked={!!rule.enabled}
                onCheckedChange={onToggle}
                aria-label={`${rule.name} enabled`}
              />
              <Button onClick={onEdit}>Edit</Button>
              <Button variant="danger" onClick={onDelete}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1 text-sm">
        <dt className="text-faint">When</dt>
        <dd>{rule.trigger ? describeTrigger(rule.trigger, names) : ''}</dd>
        {(rule.conditions?.length ?? 0) > 0 && (
          <>
            <dt className="text-faint">If</dt>
            <dd>{rule.conditions!.map((c) => describeCondition(c, names)).join(' and ')}</dd>
          </>
        )}
        <dt className="text-faint">Then</dt>
        <dd>{(rule.actions ?? []).map((a) => describeAction(a, names)).join('; ')}</dd>
      </dl>
      <p className="mt-1 text-xs text-faint">Created by {rule.createdBy?.name}</p>
    </article>
  )
}
