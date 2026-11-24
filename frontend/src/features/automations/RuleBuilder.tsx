import { useState } from 'react'
import { ApiError, messageOf } from '../../api/errors'
import type { RuleAction, RuleBody, RuleCondition, RuleTrigger, RuleView } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { TextField } from '../../shared/ui/TextField'
import { useLocationFields } from '../fields'
import { useLocationStatuses } from '../statuses'
import { useMembers } from '../workspace'
import { ACTION_LABEL, CONDITION_LABEL, PRIORITIES, TRIGGER_LABEL } from './ruleText'
import { useCreateAutomation, useUpdateAutomation } from './useAutomations'

type Props = {
  workspaceId: string
  locationId: string
  /** The rule being edited; absent for a new rule. */
  rule?: RuleView
  onClose: () => void
  restoreFocus?: () => HTMLElement | null
}

const EMPTY_ACTION: RuleAction = { type: 'ADD_COMMENT', text: '' }
const selectClass = 'rounded border border-slate-300 px-2 py-1.5 text-sm'

/** The rule builder (CAP-8): When (trigger), If (conditions) and Then (actions) fieldsets. */
export function RuleBuilder({ workspaceId, locationId, rule, onClose, restoreFocus }: Props) {
  const statuses = useLocationStatuses(workspaceId, locationId)
  const fields = useLocationFields(locationId)
  const { members } = useMembers(workspaceId)
  const create = useCreateAutomation(locationId)
  const update = useUpdateAutomation()
  const [name, setName] = useState(rule?.name ?? '')
  const [trigger, setTrigger] = useState<RuleTrigger>(rule?.trigger ?? { type: 'STATUS_CHANGED' })
  const [conditions, setConditions] = useState<RuleCondition[]>(rule?.conditions ?? [])
  const [actions, setActions] = useState<RuleAction[]>(rule?.actions ?? [{ ...EMPTY_ACTION }])
  const [error, setError] = useState<ApiError | null>(null)

  const statusNames = (statuses.data?.statuses ?? []).map((s) => s.name ?? '')
  const fieldList = fields.data?.fields ?? []
  const pending = create.isPending || update.isPending
  const stale = error?.status === 409

  function submit() {
    setError(null)
    const body: RuleBody = { name, trigger, conditions, actions }
    const done = { onSuccess: onClose, onError: (e: unknown) => setError(e as ApiError) }
    if (rule) update.mutate({ id: rule.id!, version: rule.version ?? 0, body }, done)
    else create.mutate(body, done)
  }

  const code = error?.code ?? ''
  const triggerError = code === 'automation.invalid_trigger' ? messageOf(error) : undefined
  const conditionError = code === 'automation.invalid_condition' ? messageOf(error) : undefined
  const actionError = code === 'automation.invalid_action' ? messageOf(error) : undefined
  const nameError = code === 'automation.invalid_name' ? messageOf(error) : undefined
  const otherError =
    error && !triggerError && !conditionError && !actionError && !nameError && !stale
      ? messageOf(error)
      : undefined

  return (
    <Dialog
      title={rule ? `Edit rule: ${rule.name}` : 'New rule'}
      onClose={onClose}
      restoreFocus={restoreFocus}
      wide
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {stale && (
          <p role="alert" className="rounded bg-amber-50 p-2 text-sm text-amber-900">
            Someone else changed this rule. Close this dialog to see the latest version, then edit
            again.
          </p>
        )}
        <TextField
          label="Rule name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          error={nameError}
          required
        />

        <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold">When</legend>
          <label className="flex flex-col gap-1 text-sm">
            Trigger
            <select
              className={selectClass}
              value={trigger.type}
              onChange={(e) => setTrigger({ type: e.target.value })}
            >
              {Object.entries(TRIGGER_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {trigger.type === 'STATUS_CHANGED' && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                From status (optional)
                <select
                  className={selectClass}
                  value={trigger.fromStatuses?.[0] ?? ''}
                  onChange={(e) =>
                    setTrigger({
                      ...trigger,
                      fromStatuses: e.target.value ? [e.target.value] : undefined,
                    })
                  }
                >
                  <option value="">Any status</option>
                  {statusNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                To status (optional)
                <select
                  className={selectClass}
                  value={trigger.toStatuses?.[0] ?? ''}
                  onChange={(e) =>
                    setTrigger({
                      ...trigger,
                      toStatuses: e.target.value ? [e.target.value] : undefined,
                    })
                  }
                >
                  <option value="">Any status</option>
                  {statusNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-slate-500">
                Only statuses offered here are listed. Lists below this location that use another
                status set will not match names they do not have.
              </p>
            </>
          )}
          {trigger.type === 'ASSIGNEE_CHANGED' && (
            <label className="flex flex-col gap-1 text-sm">
              When this person is added (optional)
              <select
                className={selectClass}
                value={trigger.personId ?? ''}
                onChange={(e) => setTrigger({ ...trigger, personId: e.target.value || undefined })}
              >
                <option value="">Any change</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          {trigger.type === 'CUSTOM_FIELD_CHANGED' && (
            <label className="flex flex-col gap-1 text-sm">
              Field
              <select
                className={selectClass}
                value={trigger.fieldId ?? ''}
                onChange={(e) => setTrigger({ ...trigger, fieldId: e.target.value || undefined })}
              >
                <option value="">Choose a field</option>
                {fieldList.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {triggerError && (
            <p role="alert" className="text-sm text-red-700">
              {triggerError}
            </p>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold">If (all must hold)</legend>
          {conditions.length === 0 && (
            <p className="text-sm text-slate-500">No conditions: the rule runs every time.</p>
          )}
          {conditions.map((c, i) => (
            <ConditionRow
              key={i}
              condition={c}
              statusNames={statusNames}
              members={members}
              fieldList={fieldList}
              onChange={(next) => setConditions(conditions.map((x, j) => (j === i ? next : x)))}
              onRemove={() => setConditions(conditions.filter((_, j) => j !== i))}
            />
          ))}
          <div>
            <Button
              onClick={() =>
                setConditions([...conditions, { type: 'STATUS', operator: 'IS_ONE_OF' }])
              }
              disabled={conditions.length >= 10}
            >
              Add condition
            </Button>
          </div>
          {conditionError && (
            <p role="alert" className="text-sm text-red-700">
              {conditionError}
            </p>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold">Then</legend>
          {actions.map((a, i) => (
            <ActionRow
              key={i}
              action={a}
              statusNames={statusNames}
              members={members}
              onChange={(next) => setActions(actions.map((x, j) => (j === i ? next : x)))}
              onRemove={
                actions.length > 1 ? () => setActions(actions.filter((_, j) => j !== i)) : undefined
              }
            />
          ))}
          <div>
            <Button
              onClick={() => setActions([...actions, { ...EMPTY_ACTION }])}
              disabled={actions.length >= 10}
            >
              Add action
            </Button>
          </div>
          {actionError && (
            <p role="alert" className="text-sm text-red-700">
              {actionError}
            </p>
          )}
        </fieldset>

        {otherError && (
          <p role="alert" className="text-sm text-red-700">
            {otherError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={pending || stale}>
            {rule ? 'Save rule' : 'Create rule'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

type Member = { userId?: string; displayName?: string }

function ConditionRow({
  condition: c,
  statusNames,
  members,
  fieldList,
  onChange,
  onRemove,
}: {
  condition: RuleCondition
  statusNames: string[]
  members: Member[]
  fieldList: { id?: string; name?: string }[]
  onChange: (c: RuleCondition) => void
  onRemove: () => void
}) {
  const operators: Record<string, string[]> = {
    STATUS: ['IS_ONE_OF', 'IS_NOT_ONE_OF'],
    PRIORITY: ['IS_ONE_OF', 'IS_NOT_ONE_OF'],
    ASSIGNEE: ['INCLUDES', 'IS_EMPTY', 'IS_NOT_EMPTY'],
    CUSTOM_FIELD: ['EQUALS', 'IS_EMPTY', 'IS_NOT_EMPTY'],
    TAG: ['HAS', 'NOT_HAS'],
  }
  const ops = operators[c.type ?? 'STATUS'] ?? []
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Condition">
      <select
        aria-label="Condition type"
        className={selectClass}
        value={c.type}
        onChange={(e) => onChange({ type: e.target.value, operator: operators[e.target.value][0] })}
      >
        {Object.entries(CONDITION_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select
        aria-label="Operator"
        className={selectClass}
        value={c.operator}
        onChange={(e) => onChange({ ...c, operator: e.target.value })}
      >
        {ops.map((o) => (
          <option key={o} value={o}>
            {o.toLowerCase().replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      {c.type === 'STATUS' && (
        <select
          aria-label="Status"
          className={selectClass}
          value={c.values?.[0] ?? ''}
          onChange={(e) => onChange({ ...c, values: e.target.value ? [e.target.value] : [] })}
        >
          <option value="">Choose a status</option>
          {statusNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}
      {c.type === 'PRIORITY' && (
        <select
          aria-label="Priority"
          className={selectClass}
          value={c.values?.[0] ?? ''}
          onChange={(e) => onChange({ ...c, values: e.target.value ? [e.target.value] : [] })}
        >
          <option value="">Choose a priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      )}
      {c.type === 'ASSIGNEE' && c.operator === 'INCLUDES' && (
        <select
          aria-label="Person"
          className={selectClass}
          value={c.personId ?? ''}
          onChange={(e) => onChange({ ...c, personId: e.target.value || undefined })}
        >
          <option value="">Choose a person</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName}
            </option>
          ))}
        </select>
      )}
      {c.type === 'CUSTOM_FIELD' && (
        <>
          <select
            aria-label="Field"
            className={selectClass}
            value={c.fieldId ?? ''}
            onChange={(e) => onChange({ ...c, fieldId: e.target.value || undefined })}
          >
            <option value="">Choose a field</option>
            {fieldList.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {c.operator === 'EQUALS' && (
            <input
              aria-label="Value"
              className={selectClass}
              value={c.value == null ? '' : String(c.value)}
              onChange={(e) => onChange({ ...c, value: e.target.value })}
            />
          )}
        </>
      )}
      {c.type === 'TAG' && (
        <input
          aria-label="Tag"
          className={selectClass}
          maxLength={50}
          value={c.tag ?? ''}
          onChange={(e) => onChange({ ...c, tag: e.target.value })}
        />
      )}
      <Button onClick={onRemove} aria-label="Remove condition">
        Remove
      </Button>
    </div>
  )
}

function ActionRow({
  action: a,
  statusNames,
  members,
  onChange,
  onRemove,
}: {
  action: RuleAction
  statusNames: string[]
  members: Member[]
  onChange: (a: RuleAction) => void
  onRemove?: () => void
}) {
  const toggleRecipient = (r: string) => {
    const set = new Set(a.recipients ?? [])
    if (set.has(r)) set.delete(r)
    else set.add(r)
    onChange({ ...a, recipients: [...set] })
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Action">
      <select
        aria-label="Action type"
        className={selectClass}
        value={a.type}
        onChange={(e) => onChange({ type: e.target.value })}
      >
        {Object.entries(ACTION_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {a.type === 'CHANGE_STATUS' && (
        <select
          aria-label="Status"
          className={selectClass}
          value={a.status ?? ''}
          onChange={(e) => onChange({ ...a, status: e.target.value || undefined })}
        >
          <option value="">Choose a status</option>
          {statusNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}
      {a.type === 'ASSIGN' && (
        <>
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={!!a.unassignAll}
              onChange={(e) =>
                onChange({
                  ...a,
                  unassignAll: e.target.checked || undefined,
                  personIds: e.target.checked ? undefined : a.personIds,
                })
              }
            />
            Unassign everyone
          </label>
          {!a.unassignAll && (
            <select
              aria-label="Person to assign"
              className={selectClass}
              value={a.personIds?.[0] ?? ''}
              onChange={(e) =>
                onChange({ ...a, personIds: e.target.value ? [e.target.value] : [] })
              }
            >
              <option value="">Choose a person</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      {a.type === 'SET_PRIORITY' && (
        <select
          aria-label="Priority"
          className={selectClass}
          value={a.priority ?? ''}
          onChange={(e) => onChange({ ...a, priority: e.target.value || undefined })}
        >
          <option value="">Choose a priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      )}
      {a.type === 'ADD_COMMENT' && (
        <input
          aria-label="Comment text"
          className={`${selectClass} min-w-64 flex-1`}
          value={a.text ?? ''}
          onChange={(e) => onChange({ ...a, text: e.target.value })}
        />
      )}
      {a.type === 'SET_DUE_DATE' && (
        <>
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={!!a.clearDueDate}
              onChange={(e) =>
                onChange({
                  type: a.type,
                  clearDueDate: e.target.checked || undefined,
                  daysAfter: e.target.checked ? undefined : 0,
                })
              }
            />
            Clear the due date
          </label>
          {!a.clearDueDate && (
            <input
              aria-label="Days after the trigger"
              type="number"
              min={0}
              max={365}
              className={`${selectClass} w-24`}
              value={a.daysAfter ?? 0}
              onChange={(e) => onChange({ ...a, daysAfter: Number(e.target.value) })}
            />
          )}
        </>
      )}
      {a.type === 'CREATE_SUBTASK' && (
        <input
          aria-label="Subtask title"
          className={`${selectClass} min-w-64 flex-1`}
          value={a.title ?? ''}
          onChange={(e) => onChange({ ...a, title: e.target.value })}
        />
      )}
      {a.type === 'SEND_NOTIFICATION' && (
        <>
          {['ASSIGNEES', 'WATCHERS'].map((r) => (
            <label key={r} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={a.recipients?.includes(r) ?? false}
                onChange={() => toggleRecipient(r)}
              />
              {r === 'ASSIGNEES' ? 'Assignees' : 'Watchers'}
            </label>
          ))}
          <select
            aria-label="Person to notify"
            className={selectClass}
            value={a.personIds?.[0] ?? ''}
            onChange={(e) => onChange({ ...a, personIds: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">A specific person (optional)</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </select>
          <input
            aria-label="Message"
            className={`${selectClass} min-w-64 flex-1`}
            value={a.message ?? ''}
            maxLength={500}
            onChange={(e) => onChange({ ...a, message: e.target.value })}
          />
        </>
      )}
      {onRemove && (
        <Button onClick={onRemove} aria-label="Remove action">
          Remove
        </Button>
      )}
    </div>
  )
}
