import * as SelectPrimitive from '@radix-ui/react-select'
import { useRef } from 'react'
import { floatingClass, floatingProps, itemClass, keepFocusIfMoved } from './floating'

export type SelectOption = { value: string; label: string; disabled?: boolean }
export type SelectGroup = { label: string; options: readonly SelectOption[] }

export type SelectProps = {
  value: string
  onValueChange: (value: string) => void
  options?: readonly SelectOption[]
  groups?: readonly SelectGroup[]
  /** Shown on the trigger only, never as an item (AD-5). Use it for a prompt such as "Choose a status". */
  placeholder?: string
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  name?: string
}

// Radix forbids an item with the value ''. A real '' choice (for example "Any status") is mapped to this
// sentinel and back, so callers keep their '' semantics (AD-5).
const EMPTY = '__tf_empty__'
const toRadix = (value: string) => (value === '' ? EMPTY : value)

/**
 * A select with a floating, themed listbox. `value` and `onValueChange` use the caller's own values.
 * With no '' item, a value of '' (or a value that matches no option) shows the placeholder and the
 * stored value is left unchanged.
 */
export function Select({
  value,
  onValueChange,
  options = [],
  groups = [],
  placeholder,
  className,
  autoFocus,
  ...aria
}: SelectProps) {
  const all = [...options, ...groups.flatMap((g) => g.options)]
  const radixValue = all.some((o) => o.value === value) ? toRadix(value) : ''
  const triggerRef = useRef<HTMLButtonElement>(null)
  const renderItem = (o: SelectOption) => (
    <SelectPrimitive.Item
      key={o.value}
      value={toRadix(o.value)}
      disabled={o.disabled}
      className={`${itemClass} pr-6`}
    >
      <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 text-accent">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 8.5l3.2 3L13 4.5" />
        </svg>
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
  return (
    <SelectPrimitive.Root
      value={radixValue}
      onValueChange={(next) => onValueChange(next === EMPTY ? '' : next)}
      disabled={aria.disabled}
      name={aria.name}
    >
      <SelectPrimitive.Trigger
        ref={triggerRef}
        id={aria.id}
        aria-label={aria['aria-label']}
        aria-labelledby={aria['aria-labelledby']}
        autoFocus={autoFocus}
        // The native <select> this replaces stopped click propagation so a row behind it did not react.
        onClick={(event) => event.stopPropagation()}
        className={`inline-flex h-8 min-w-0 items-center justify-between gap-2 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-fg disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-faint ${className ?? ''}`}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon aria-hidden="true" className="text-muted">
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          {...floatingProps}
          onCloseAutoFocus={(event) => keepFocusIfMoved(event, triggerRef.current)}
          className={`${floatingClass} max-h-72 min-w-(--radix-select-trigger-width) overflow-hidden p-1`}
        >
          <SelectPrimitive.Viewport>
            {options.map(renderItem)}
            {groups.map((g) => (
              <SelectPrimitive.Group key={g.label}>
                <SelectPrimitive.Label className="px-2 py-1 text-xs font-medium text-muted">
                  {g.label}
                </SelectPrimitive.Label>
                {g.options.map(renderItem)}
              </SelectPrimitive.Group>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
