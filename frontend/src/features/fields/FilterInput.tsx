import { useState } from 'react'
import type { FieldView } from '../../api/types'
import { Checkbox } from '../../shared/ui/Checkbox'
import { Select } from '../../shared/ui/Select'
import { isValueless } from './filterOps'

type FilterInputProps = {
  field: FieldView
  op: string
  value: unknown
  onChange: (value: unknown) => void
  /** The Workspace's members plus "Me", for a People field. */
  people?: Array<{ value: string; label: string }>
}

const input =
  'h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-fg placeholder:text-faint'
const RELATIVE = [
  ['today', 'today'],
  ['this_week', 'this week'],
  ['next_7_days', 'next 7 days'],
]

/** A number box that keeps what is typed ("1.") and reports only valid numbers. */
function NumberBox({
  label,
  value,
  onChange,
  className,
}: {
  label: string
  value: unknown
  onChange: (next: number) => void
  className: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (typeof value === 'number' ? String(value) : '')
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      className={className}
      value={shown}
      onChange={(event) => {
        const text = event.target.value
        setDraft(text)
        const n = Number(text.replace(',', '.'))
        if (text.trim() !== '' && Number.isFinite(n)) onChange(n)
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

/** A day: a calendar day, or one of the relative values the server resolves each day. */
function DayInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: unknown
  onChange: (next: string) => void
}) {
  const text = typeof value === 'string' ? value : ''
  const relative = RELATIVE.some(([v]) => v === text)
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="date"
        aria-label={label}
        className={input}
        value={relative ? '' : text}
        onChange={(event) => event.target.value && onChange(event.target.value)}
      />
      <Select
        aria-label={`${label} (relative)`}
        value={relative ? text : ''}
        placeholder="or relative…"
        onValueChange={(next) => next && onChange(next)}
        options={RELATIVE.map(([value, label]) => ({ value, label }))}
      />
    </span>
  )
}

/** The value input of a custom field filter condition (AD-12), by the field's type and operator. */
export function FilterInput({ field, op, value, onChange, people }: FilterInputProps) {
  if (isValueless(op)) return null
  const list = Array.isArray(value) ? value : []
  if (['contains', 'not_contains'].includes(op)) {
    return (
      <input
        aria-label="Filter value"
        className={input}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }
  if (['any_of', 'all_of', 'none_of'].includes(op)) {
    const selected = list as string[]
    return (
      <span role="group" aria-label="Filter value" className="flex flex-wrap gap-2">
        {(field.type === 'PEOPLE'
          ? (people ?? [])
          : (field.options ?? []).map((o) => ({ value: o.id!, label: o.name ?? '' }))
        ).map((option) => (
          <Checkbox
            key={option.value}
            label={option.label}
            checked={selected.includes(option.value)}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...selected, option.value]
                  : selected.filter((id) => id !== option.value),
              )
            }
          />
        ))}
      </span>
    )
  }
  if (field.type === 'DATE') {
    if (op === 'between') {
      return (
        <span className="inline-flex items-center gap-1">
          <DayInput
            label="Filter value from"
            value={list[0]}
            onChange={(day) => onChange([day, list[1] ?? day])}
          />
          and
          <DayInput
            label="Filter value to"
            value={list[1]}
            onChange={(day) => onChange([list[0] ?? day, day])}
          />
        </span>
      )
    }
    return <DayInput label="Filter value" value={value} onChange={onChange} />
  }
  if (op === 'between') {
    return (
      <span className="inline-flex items-center gap-1">
        <NumberBox
          label="Filter value from"
          className={`${input} w-20`}
          value={list[0]}
          onChange={(n) => onChange([n, list[1] ?? n])}
        />
        and
        <NumberBox
          label="Filter value to"
          className={`${input} w-20`}
          value={list[1]}
          onChange={(n) => onChange([list[0] ?? n, n])}
        />
      </span>
    )
  }
  return (
    <NumberBox label="Filter value" className={`${input} w-24`} value={value} onChange={onChange} />
  )
}
