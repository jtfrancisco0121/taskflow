import * as CheckboxPrimitive from '@radix-ui/react-checkbox'

type CheckboxProps = {
  checked: boolean | 'indeterminate'
  onCheckedChange: (checked: boolean) => void
  /** A visible label. Without one, pass `aria-label`. */
  label?: string
  id?: string
  'aria-label'?: string
  disabled?: boolean
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  id,
  disabled,
  ...aria
}: CheckboxProps) {
  const box = (
    <CheckboxPrimitive.Root
      id={id}
      aria-label={aria['aria-label']}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-line-strong bg-surface text-accent-fg data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      <CheckboxPrimitive.Indicator>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          {checked === 'indeterminate' ? <path d="M3.5 8h9" /> : <path d="M3 8.5l3.2 3L13 4.5" />}
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
  if (!label) return box
  return (
    <label className="inline-flex items-center gap-2 text-[13px] text-fg">
      {box}
      {label}
    </label>
  )
}
