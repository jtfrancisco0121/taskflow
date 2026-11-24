import type { RuleView } from '../../api/types'
import { Button } from '../../shared/ui/Button'
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
  SUCCEEDED: 'bg-green-100 text-green-800',
  SKIPPED: 'bg-slate-100 text-slate-700',
  FAILED: 'bg-red-100 text-red-800',
}

/** One rule: its sentence, an enable switch (editors only), the last run and Edit / Delete. */
export function RuleCard({ rule, names, canEdit, onToggle, onEdit, onDelete, onHistory }: Props) {
  const last = rule.lastRun
  return (
    <article
      aria-label={rule.name}
      className="rounded border border-slate-200 bg-white p-3"
      data-enabled={rule.enabled}
    >
      <div className="flex items-center gap-2">
        <h2 className="font-medium">{rule.name}</h2>
        {rule.inherited && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
            From {rule.definedAtName}
          </span>
        )}
        {!rule.enabled && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">Off</span>
        )}
        {last && (
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${RUN_STYLE[last.status ?? ''] ?? ''}`}
            title={last.reason ?? undefined}
          >
            Last run: {(last.status ?? '').toLowerCase()}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {onHistory && <Button onClick={onHistory}>History</Button>}
          {canEdit && (
            <>
              <button
                type="button"
                role="switch"
                aria-checked={rule.enabled}
                aria-label={`${rule.name} enabled`}
                onClick={() => onToggle(!rule.enabled)}
                className={`relative h-5 w-9 rounded-full ${rule.enabled ? 'bg-blue-600' : 'bg-slate-300'} focus:outline-2 focus:outline-offset-2 focus:outline-blue-600`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${rule.enabled ? 'left-4.5' : 'left-0.5'}`}
                />
              </button>
              <Button onClick={onEdit}>Edit</Button>
              <Button variant="danger" onClick={onDelete}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1 text-sm">
        <dt className="text-slate-500">When</dt>
        <dd>{rule.trigger ? describeTrigger(rule.trigger, names) : ''}</dd>
        {(rule.conditions?.length ?? 0) > 0 && (
          <>
            <dt className="text-slate-500">If</dt>
            <dd>{rule.conditions!.map((c) => describeCondition(c, names)).join(' and ')}</dd>
          </>
        )}
        <dt className="text-slate-500">Then</dt>
        <dd>{(rule.actions ?? []).map((a) => describeAction(a, names)).join('; ')}</dd>
      </dl>
      <p className="mt-1 text-xs text-slate-500">Created by {rule.createdBy?.name}</p>
    </article>
  )
}
