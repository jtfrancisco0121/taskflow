import type { FieldView } from '../../api/types'
import { formatValue, isEmpty, optionName } from './format'
import { OptionChip } from './OptionChip'

/** A compact chip of one value for Board cards; the field name is its accessible name and tooltip. */
export function ValueChip({ field, value }: { field: FieldView; value: unknown }) {
  if (isEmpty(value)) return null
  const text = formatValue(field, value)
  const label = `${field.name}: ${text}`
  if (field.type === 'DROPDOWN') {
    const color = field.options?.find((o) => o.id === value)?.color
    return (
      <span title={label} aria-label={label}>
        <OptionChip name={optionName(field, value)} color={color} />
      </span>
    )
  }
  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-900"
    >
      {text}
    </span>
  )
}
