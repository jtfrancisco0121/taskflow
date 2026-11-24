import type { FieldView } from '../../api/types'
import { formatValue, isEmpty, optionName, safeHref } from './format'
import { OptionChip } from './OptionChip'

type ValueCellProps = { field: FieldView; value: unknown }

function maxOf(field: FieldView) {
  const v = field.config?.max
  return typeof v === 'number' ? v : 5
}

/** The read-only rendering of a value: text as text, URLs as links only when http(s) (AD-12). */
export function ValueCell({ field, value }: ValueCellProps) {
  if (isEmpty(value)) {
    return (
      <span className="text-slate-400">
        <span aria-hidden="true">—</span>
        <span className="sr-only">empty</span>
      </span>
    )
  }
  switch (field.type) {
    case 'DROPDOWN':
      return <OptionChip name={optionName(field, value)} color={colorOf(field, value)} />
    case 'LABELS':
      return (
        <span className="flex flex-wrap gap-1">
          {(value as string[]).map((id) => (
            <OptionChip key={id} name={optionName(field, id)} color={colorOf(field, id)} />
          ))}
        </span>
      )
    case 'CHECKBOX':
      return <span>Checked</span>
    case 'URL': {
      const href = safeHref(value)
      return href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 underline"
          onClick={(event) => event.stopPropagation()}
        >
          {String(value)}
        </a>
      ) : (
        <span>{String(value)}</span>
      )
    }
    case 'EMAIL':
      return (
        <a
          href={`mailto:${String(value)}`}
          className="text-blue-700 underline"
          onClick={(event) => event.stopPropagation()}
        >
          {String(value)}
        </a>
      )
    case 'RATING': {
      const max = maxOf(field)
      const on = Number(value)
      return (
        <span role="img" aria-label={formatValue(field, value)} className="whitespace-nowrap">
          {Array.from({ length: max }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={i < on ? 'text-amber-500' : 'text-slate-300'}
            >
              ★
            </span>
          ))}
        </span>
      )
    }
    case 'PROGRESS':
      return (
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="h-1.5 w-16 rounded-full bg-slate-200">
            <span
              className="block h-1.5 rounded-full bg-green-600"
              style={{ width: `${Math.min(100, Math.max(0, Number(value)))}%` }}
            />
          </span>
          <span className="text-xs">{Number(value)}%</span>
        </span>
      )
    case 'LONG_TEXT':
      return <span className="whitespace-pre-wrap">{String(value)}</span>
    default:
      return <span>{formatValue(field, value)}</span>
  }
}

function colorOf(field: FieldView, id: unknown): string | undefined {
  return field.options?.find((o) => o.id === id)?.color
}
