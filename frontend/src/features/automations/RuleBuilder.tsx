import { useState } from 'react'
import { ApiError, messageOf } from '../../api/errors'
import type { RuleAction, RuleBody, RuleCondition, RuleTrigger, RuleView } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { Checkbox } from '../../shared/ui/Checkbox'
import { Dialog } from '../../shared/ui/Dialog'
import { Select } from '../../shared/ui/Select'
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
const selectClass =
  'rounded-md border border-line-strong bg-surface px-2 py-1.5 text-[13px] text-fg placeholder:text-faint'
const memberOptions = (members: Member[]) =>
  members.map((m) => ({ value: m.userId ?? '', label: m.displayName ?? '' }))
const fieldOptions = (fields: { id?: string; name?: string }[]) =>
  fields.map((f) => ({ value: f.id ?? '', label: f.name ?? '' }))

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
          <p role="alert" className="rounded-md bg-warn-soft p-2 text-sm text-fg">
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

        <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-semibold text-fg">When</legend>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Trigger
            <Select
              value={trigger.type ?? ''}
              onValueChange={(next) => setTrigger({ type: next })}
              options={Object.entries(TRIGGER_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </label>
          {trigger.type === 'STATUS_CHANGED' && (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                From status (optional)
                <Select
                  value={trigger.fromStatuses?.[0] ?? ''}
                  onValueChange={(next) =>
                    setTrigger({ ...trigger, fromStatuses: next ? [next] : undefined })
                  }
                  options={[
                    { value: '', label: 'Any status' },
                    ...statusNames.map((n) => ({ value: n, label: n })),
                  ]}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                To status (optional)
                <Select
                  value={trigger.toStatuses?.[0] ?? ''}
                  onValueChange={(next) =>
                    setTrigger({ ...trigger, toStatuses: next ? [next] : undefined })
                  }
                  options={[
                    { value: '', label: 'Any status' },
                    ...statusNames.map((n) => ({ value: n, label: n })),
                  ]}
                />
              </label>
              <p className="text-xs text-muted">
                Only statuses offered here are listed. Lists below this location that use another
                status set will not match names they do not have.
              </p>
            </>
          )}
          {trigger.type === 'ASSIGNEE_CHANGED' && (
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              When this person is added (optional)
              <Select
                value={trigger.personId ?? ''}
                onValueChange={(next) => setTrigger({ ...trigger, personId: next || undefined })}
                options={[{ value: '', label: 'Any change' }, ...memberOptions(members)]}
              />
            </label>
          )}
          {trigger.type === 'CUSTOM_FIELD_CHANGED' && (
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Field
              <Select
                value={trigger.fieldId ?? ''}
                onValueChange={(next) => setTrigger({ ...trigger, fieldId: next || undefined })}
                options={fieldOptions(fieldList)}
                placeholder="Choose a field"
              />
            </label>
          )}
          {triggerError && (
            <p role="alert" className="text-sm text-danger">
              {triggerError}
            </p>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-semibold text-fg">If (all must hold)</legend>
          {conditions.length === 0 && (
            <p className="text-sm text-muted">No conditions: the rule runs every time.</p>
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
            <p role="alert" className="text-sm text-danger">
              {conditionError}
            </p>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-semibold text-fg">Then</legend>
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
            <p role="alert" className="text-sm text-danger">
              {actionError}
            </p>
          )}
        </fieldset>

        {otherError && (
          <p role="alert" className="text-sm text-danger">
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
      <Select
        aria-label="Condition type"
        value={c.type ?? ''}
        onValueChange={(next) => onChange({ type: next, operator: operators[next][0] })}
        options={Object.entries(CONDITION_LABEL).map(([value, label]) => ({ value, label }))}
      />
      <Select
        aria-label="Operator"
        value={c.operator ?? ''}
        onValueChange={(next) => onChange({ ...c, operator: next })}
        options={ops.map((o) => ({ value: o, label: o.toLowerCase().replace(/_/g, ' ') }))}
      />
      {c.type === 'STATUS' && (
        <Select
          aria-label="Status"
          value={c.values?.[0] ?? ''}
          onValueChange={(next) => onChange({ ...c, values: next ? [next] : [] })}
          options={statusNames.map((n) => ({ value: n, label: n }))}
          placeholder="Choose a status"
        />
      )}
      {c.type === 'PRIORITY' && (
        <Select
          aria-label="Priority"
          value={c.values?.[0] ?? ''}
          onValueChange={(next) => onChange({ ...c, values: next ? [next] : [] })}
          options={PRIORITIES.map((p) => ({ value: p, label: p }))}
          placeholder="Choose a priority"
        />
      )}
      {c.type === 'ASSIGNEE' && c.operator === 'INCLUDES' && (
        <Select
          aria-label="Person"
          value={c.personId ?? ''}
          onValueChange={(next) => onChange({ ...c, personId: next || undefined })}
          options={memberOptions(members)}
          placeholder="Choose a person"
        />
      )}
      {c.type === 'CUSTOM_FIELD' && (
        <>
          <Select
            aria-label="Field"
            value={c.fieldId ?? ''}
            onValueChange={(next) => onChange({ ...c, fieldId: next || undefined })}
            options={fieldOptions(fieldList)}
            placeholder="Choose a field"
          />
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
      <Select
        aria-label="Action type"
        value={a.type ?? ''}
        onValueChange={(next) => onChange({ type: next })}
        options={Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }))}
      />
      {a.type === 'CHANGE_STATUS' && (
        <Select
          aria-label="Status"
          value={a.status ?? ''}
          onValueChange={(next) => onChange({ ...a, status: next || undefined })}
          options={statusNames.map((n) => ({ value: n, label: n }))}
          placeholder="Choose a status"
        />
      )}
      {a.type === 'ASSIGN' && (
        <>
          <Checkbox
            label="Unassign everyone"
            checked={!!a.unassignAll}
            onCheckedChange={(checked) =>
              onChange({
                ...a,
                unassignAll: checked || undefined,
                personIds: checked ? undefined : a.personIds,
              })
            }
          />
          {!a.unassignAll && (
            <Select
              aria-label="Person to assign"
              value={a.personIds?.[0] ?? ''}
              onValueChange={(next) => onChange({ ...a, personIds: next ? [next] : [] })}
              options={memberOptions(members)}
              placeholder="Choose a person"
            />
          )}
        </>
      )}
      {a.type === 'SET_PRIORITY' && (
        <Select
          aria-label="Priority"
          value={a.priority ?? ''}
          onValueChange={(next) => onChange({ ...a, priority: next || undefined })}
          options={PRIORITIES.map((p) => ({ value: p, label: p }))}
          placeholder="Choose a priority"
        />
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
          <Checkbox
            label="Clear the due date"
            checked={!!a.clearDueDate}
            onCheckedChange={(checked) =>
              onChange({
                type: a.type,
                clearDueDate: checked || undefined,
                daysAfter: checked ? undefined : 0,
              })
            }
          />
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
            <Checkbox
              key={r}
              label={r === 'ASSIGNEES' ? 'Assignees' : 'Watchers'}
              checked={a.recipients?.includes(r) ?? false}
              onCheckedChange={() => toggleRecipient(r)}
            />
          ))}
          <Select
            aria-label="Person to notify"
            value={a.personIds?.[0] ?? ''}
            onValueChange={(next) => onChange({ ...a, personIds: next ? [next] : [] })}
            options={[
              { value: '', label: 'A specific person (optional)' },
              ...memberOptions(members),
            ]}
          />
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
