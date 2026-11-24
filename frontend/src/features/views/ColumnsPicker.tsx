import type { FieldView } from '../../api/types'
import { FIELD_TYPES } from '../fields'
import { COLUMN_LABEL, toggleColumn } from './tableColumns'
import { COLUMN_FIELDS, type Column } from './urlState'

/** The Columns control: built-in columns (Table only) and the custom fields available at the scope. */
export function ColumnsPicker({
  columns,
  fields,
  builtIn,
  onChange,
}: {
  columns: Column[]
  fields: FieldView[]
  builtIn: boolean
  onChange: (next: Column[]) => void
}) {
  if (!builtIn && fields.length === 0) return null
  return (
    <details className="mb-2 text-sm">
      <summary className="cursor-pointer">Columns</summary>
      {builtIn && (
        <div className="mt-1 flex flex-wrap gap-3">
          {COLUMN_FIELDS.map((field) => (
            <label key={field} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={columns.some((c) => c.field === field)}
                disabled={field === 'title'}
                onChange={(e) => onChange(toggleColumn(columns, field, e.target.checked))}
              />
              {COLUMN_LABEL[field] ?? field}
            </label>
          ))}
        </div>
      )}
      {fields.length > 0 && (
        <fieldset className="mt-1 border-0 p-0">
          <legend className="text-xs font-medium text-slate-500">Custom fields</legend>
          <div className="flex flex-wrap gap-3">
            {fields.map((field) => {
              const ref = `cf:${field.id}`
              return (
                <label key={field.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={columns.some((c) => c.field === ref)}
                    onChange={(e) => onChange(toggleColumn(columns, ref, e.target.checked))}
                  />
                  <span aria-hidden="true" className="font-mono text-xs text-slate-500">
                    {FIELD_TYPES[field.type ?? 'TEXT'].icon}
                  </span>
                  {field.name}
                  <span className="text-xs text-slate-500">from {field.definedAtName}</span>
                </label>
              )
            })}
          </div>
        </fieldset>
      )}
    </details>
  )
}
