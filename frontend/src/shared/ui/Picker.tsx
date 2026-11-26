import { Command as CommandPrimitive } from 'cmdk'
import { useState, type ReactElement, type ReactNode } from 'react'
import { Popover } from './Popover'

export type PickerItem = {
  value: string
  label: string
  /** Muted text after the label (a weekday, a count). Hidden from the accessible name. */
  hint?: string
  /** Replaces the label text in the row (an avatar and a name, a badge). The accessible name stays `label`. */
  render?: ReactNode
  /** Extra words the search also matches (never the raw `value`, which can be an id). */
  keywords?: string[]
}

/** Matches the label and keywords only: `value` is often a UUID, and typing hex must not find it. */
function matchLabel(_value: string, search: string, keywords?: string[]): number {
  const needle = search.trim().toLowerCase()
  if (!needle) return 1
  return (keywords ?? []).some((word) => word.toLowerCase().includes(needle)) ? 1 : 0
}

type PickerProps = {
  /** One element, usually a button showing the current value: it opens and closes the popover. */
  trigger: ReactElement
  /** The accessible name of the popover and of its search field. */
  label: string
  items: PickerItem[]
  /** The values that are currently chosen. */
  selected: string[]
  /** `single` closes after a pick, `multi` stays open and toggles. */
  mode: 'single' | 'multi'
  onPick: (value: string) => void
  placeholder?: string
  /** Extra content under the list (the due editor's day field). */
  footer?: ReactNode
  /** A non-selectable row above the items, for example "Loading people…". */
  loading?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * A searchable list in a popover (AD-1): the one editor for status, priority, assignee and due. Items are
 * `role="option"` named by their label, so tests pick them by visible label through `src/test/ui.ts`.
 */
export function Picker({
  trigger,
  label,
  items,
  selected,
  mode,
  onPick,
  placeholder = 'Search…',
  footer,
  loading,
  open,
  onOpenChange,
}: PickerProps) {
  const [inner, setInner] = useState(false)
  const isOpen = open ?? inner
  const setOpen = (next: boolean) => {
    setInner(next)
    onOpenChange?.(next)
  }
  return (
    <Popover trigger={trigger} label={label} open={isOpen} onOpenChange={setOpen}>
      <CommandPrimitive
        label={label}
        filter={matchLabel}
        className="flex w-60 flex-col text-[13px] text-fg"
      >
        <CommandPrimitive.Input
          placeholder={placeholder}
          aria-label={label}
          className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-fg placeholder:text-faint"
        />
        <CommandPrimitive.List className="mt-1 max-h-64 overflow-auto">
          <CommandPrimitive.Empty className="px-2 py-3 text-center text-muted">
            No match
          </CommandPrimitive.Empty>
          {loading && (
            <div role="status" className="px-2 py-1 text-xs text-muted">
              {loading}
            </div>
          )}
          {items.map((item) => {
            const checked = selected.includes(item.value)
            return (
              <CommandPrimitive.Item
                key={item.value}
                value={item.value}
                keywords={[item.label, ...(item.keywords ?? [])]}
                aria-label={item.label}
                aria-checked={checked}
                data-checked={checked ? '' : undefined}
                onSelect={() => {
                  onPick(item.value)
                  if (mode === 'single') setOpen(false)
                }}
                className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 data-[selected=true]:bg-accent-soft"
              >
                <span aria-hidden="true" className="w-3 text-xs text-accent">
                  {checked ? '✓' : ''}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.render ?? item.label}</span>
                {item.hint && (
                  <span aria-hidden="true" className="text-xs text-muted">
                    {item.hint}
                  </span>
                )}
              </CommandPrimitive.Item>
            )
          })}
        </CommandPrimitive.List>
        {footer && (
          <div
            className="mt-2 border-t border-line pt-2"
            // cmdk handles Enter and arrows for everything inside its root; keep them for the footer.
            onKeyDown={(e) => {
              if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation()
            }}
          >
            {footer}
          </div>
        )}
      </CommandPrimitive>
    </Popover>
  )
}
