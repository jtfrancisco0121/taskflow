import { Command as CommandPrimitive } from 'cmdk'
import { useState, type ReactElement } from 'react'
import { Popover } from './Popover'

export type CommandItem = {
  value: string
  label: string
  onSelect: () => void
  disabled?: boolean
  /** Mono text before the label, for example a task id. */
  lead?: string
  /** Muted text after the label, right-aligned, for example a List name. */
  detail?: string
  /** Shows a check mark (the current choice). */
  checked?: boolean
}
export type CommandGroup = {
  heading: string
  items: CommandItem[]
  /** `false`: the items come from the server and are never hidden by the typed text. */
  filter?: false
  /** A non-selectable row under the heading. */
  status?: { kind: 'loading' | 'error'; text: string }
}

type CommandProps = {
  groups: CommandGroup[]
  /** The accessible name of the search box and the list. */
  label: string
  placeholder?: string
  emptyText?: string
  /** Controlled search text; uncontrolled when absent. */
  search?: string
  onSearchChange?: (search: string) => void
  /** `palette` fills its container and its list is taller. */
  size?: 'popover' | 'palette'
}

const matches = (item: CommandItem, search: string) =>
  `${item.label} ${item.detail ?? ''} ${item.lead ?? ''}`
    .toLowerCase()
    .includes(search.toLowerCase())

/** A search box over grouped, filterable items; arrows move, Enter runs the item. */
export function Command({
  groups,
  label,
  placeholder = 'Search…',
  emptyText = 'No results',
  search,
  onSearchChange,
  size = 'popover',
}: CommandProps) {
  const [inner, setInner] = useState('')
  const text = search ?? inner
  // With a server-backed group the root stops filtering and the static groups are filtered here, by label.
  const serverBacked = groups.some((group) => group.filter === false)
  const palette = size === 'palette'
  return (
    <CommandPrimitive
      label={label}
      shouldFilter={!serverBacked}
      className={`flex flex-col text-[13px] text-fg ${palette ? 'w-full' : 'w-72'}`}
    >
      <CommandPrimitive.Input
        placeholder={placeholder}
        aria-label={label}
        value={text}
        onValueChange={(value) => {
          setInner(value)
          onSearchChange?.(value)
        }}
        className={`rounded-md border border-line-strong bg-surface px-2 text-fg placeholder:text-faint ${palette ? 'h-12 text-[15px]' : 'h-8 text-[13px]'}`}
      />
      <CommandPrimitive.List
        className={`mt-1 overflow-auto ${palette ? 'max-h-[min(60vh,420px)]' : 'max-h-64'}`}
      >
        <CommandPrimitive.Empty className="px-2 py-3 text-center text-muted">
          {emptyText}
        </CommandPrimitive.Empty>
        {groups.map((group) => {
          const items =
            serverBacked && group.filter !== false && text
              ? group.items.filter((item) => matches(item, text))
              : group.items
          if (serverBacked && items.length === 0 && !group.status) return null
          return (
            <CommandPrimitive.Group
              key={group.heading}
              heading={group.heading}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted"
            >
              {group.status && (
                <div
                  role={group.status.kind === 'error' ? 'alert' : 'status'}
                  className={`px-2 py-1 text-xs ${group.status.kind === 'error' ? 'text-danger' : 'text-muted'}`}
                >
                  {group.status.text}
                </div>
              )}
              {items.map((item) => (
                <CommandPrimitive.Item
                  key={item.value}
                  value={item.value}
                  keywords={[item.label]}
                  disabled={item.disabled}
                  onSelect={item.onSelect}
                  className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent-soft"
                >
                  {item.lead && <span className="font-mono text-xs text-muted">{item.lead}</span>}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.detail && <span className="text-xs text-muted">{item.detail}</span>}
                  {item.checked && <span aria-label="Current">✓</span>}
                </CommandPrimitive.Item>
              ))}
            </CommandPrimitive.Group>
          )
        })}
      </CommandPrimitive.List>
    </CommandPrimitive>
  )
}

/** A Command inside a floating panel anchored to a trigger. */
export function CommandPopover({ trigger, ...command }: CommandProps & { trigger: ReactElement }) {
  return (
    <Popover trigger={trigger} label={command.label}>
      <Command {...command} />
    </Popover>
  )
}
