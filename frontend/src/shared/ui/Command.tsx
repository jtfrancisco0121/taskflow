import { Command as CommandPrimitive } from 'cmdk'
import type { ReactElement } from 'react'
import { Popover } from './Popover'

export type CommandItem = { value: string; label: string; onSelect: () => void; disabled?: boolean }
export type CommandGroup = { heading: string; items: CommandItem[] }

type CommandProps = {
  groups: CommandGroup[]
  /** The accessible name of the search box and the list. */
  label: string
  placeholder?: string
  emptyText?: string
}

/** A search box over grouped, filterable items; arrows move, Enter runs the item. */
export function Command({
  groups,
  label,
  placeholder = 'Search…',
  emptyText = 'No results',
}: CommandProps) {
  return (
    <CommandPrimitive label={label} className="flex w-72 flex-col text-[13px] text-fg">
      <CommandPrimitive.Input
        placeholder={placeholder}
        aria-label={label}
        className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-fg placeholder:text-faint"
      />
      <CommandPrimitive.List className="mt-1 max-h-64 overflow-auto">
        <CommandPrimitive.Empty className="px-2 py-3 text-center text-muted">
          {emptyText}
        </CommandPrimitive.Empty>
        {groups.map((group) => (
          <CommandPrimitive.Group
            key={group.heading}
            heading={group.heading}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted"
          >
            {group.items.map((item) => (
              <CommandPrimitive.Item
                key={item.value}
                value={item.value}
                keywords={[item.label]}
                disabled={item.disabled}
                onSelect={item.onSelect}
                className="flex h-7 cursor-pointer items-center rounded-md px-2 data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent-soft"
              >
                {item.label}
              </CommandPrimitive.Item>
            ))}
          </CommandPrimitive.Group>
        ))}
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
