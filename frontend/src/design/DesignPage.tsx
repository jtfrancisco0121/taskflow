import { useState, type ReactNode } from 'react'
import { useToastStore } from '../shared/toast-store'
import { AgentBadge } from '../shared/ui/AgentBadge'
import { AutomationBadge } from '../shared/ui/AutomationBadge'
import { Avatar } from '../shared/ui/Avatar'
import { Button } from '../shared/ui/Button'
import { Checkbox } from '../shared/ui/Checkbox'
import { Command } from '../shared/ui/Command'
import { Dialog } from '../shared/ui/Dialog'
import { DropdownMenu } from '../shared/ui/DropdownMenu'
import { EmptyState } from '../shared/ui/EmptyState'
import { ErrorState } from '../shared/ui/ErrorState'
import { IconButton } from '../shared/ui/IconButton'
import { Kbd } from '../shared/ui/Kbd'
import { PageHeader } from '../shared/ui/PageHeader'
import { Popover } from '../shared/ui/Popover'
import { PriorityBadge } from '../shared/ui/PriorityBadge'
import { Select } from '../shared/ui/Select'
import { Skeleton } from '../shared/ui/Skeleton'
import { StatusBadge } from '../shared/ui/StatusBadge'
import { StatusPill } from '../shared/ui/StatusPill'
import { Switch } from '../shared/ui/Switch'
import { ThemeSwitcher } from '../shared/ui/ThemeSwitcher'
import { Textarea } from '../shared/ui/Textarea'
import { TextField } from '../shared/ui/TextField'
import { Tooltip } from '../shared/ui/Tooltip'

const STATUSES = [
  { value: 'todo', label: 'To do' },
  { value: 'progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-3 font-display text-base font-semibold">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  )
}

const flag = (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
    <path d="M3 1.5h1.5V3H13l-2 3 2 3H4.5v5.5H3z" />
  </svg>
)

/** DEV only (AD-6): every library component in its states, with a local Light / Aurora / System toggle. */
export function DesignPage() {
  const [status, setStatus] = useState('progress')
  const [anyStatus, setAnyStatus] = useState('')
  const [prompted, setPrompted] = useState('')
  const [checked, setChecked] = useState(true)
  const [on, setOn] = useState(true)
  const [dialog, setDialog] = useState(false)
  const showToast = useToastStore((state) => state.show)

  return (
    <main data-tf-design-page className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <PageHeader title="Design system">
        <ThemeSwitcher />
      </PageHeader>

      <Section title="Buttons">
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="primary" disabled>
          Disabled
        </Button>
      </Section>

      <Section title="Icon buttons">
        <IconButton label="Flag the task">{flag}</IconButton>
        <IconButton label="Flag disabled" disabled>
          {flag}
        </IconButton>
      </Section>

      <Section title="Text fields">
        <TextField label="Task title" placeholder="Write a title" />
        <TextField label="Title with error" defaultValue="x" error="A title needs 3 characters" />
        <Textarea label="Description" placeholder="Describe the task" />
      </Section>

      <Section title="Selects">
        <div className="flex flex-col gap-1">
          <label htmlFor="design-status" className="text-xs font-medium text-muted">
            Status select
          </label>
          <Select id="design-status" value={status} onValueChange={setStatus} options={STATUSES} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="design-prompt" className="text-xs font-medium text-muted">
            Prompted select
          </label>
          <Select
            id="design-prompt"
            value={prompted}
            onValueChange={setPrompted}
            options={STATUSES}
            placeholder="Choose a status"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="design-any" className="text-xs font-medium text-muted">
            Any select
          </label>
          <Select
            id="design-any"
            value={anyStatus}
            onValueChange={setAnyStatus}
            options={[{ value: '', label: 'Any status' }, ...STATUSES]}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="design-grouped" className="text-xs font-medium text-muted">
            Grouped select
          </label>
          <Select
            id="design-grouped"
            value=""
            onValueChange={() => {}}
            placeholder="Group by"
            groups={[
              { label: 'Fields', options: [{ value: 'status', label: 'Status' }] },
              { label: 'People', options: [{ value: 'assignee', label: 'Assignee' }] },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="design-disabled" className="text-xs font-medium text-muted">
            Disabled select
          </label>
          <Select
            id="design-disabled"
            value="todo"
            onValueChange={() => {}}
            options={STATUSES}
            disabled
          />
        </div>
      </Section>

      <Section title="Checkbox and switch">
        <Checkbox label="Checked" checked={checked} onCheckedChange={setChecked} />
        <Checkbox label="Unchecked" checked={false} onCheckedChange={() => {}} />
        <Checkbox label="Some selected" checked="indeterminate" onCheckedChange={() => {}} />
        <Switch label="Notifications" checked={on} onCheckedChange={setOn} />
        <Switch label="Switch off" checked={false} onCheckedChange={() => {}} />
      </Section>

      <Section title="Floating layers">
        <Popover trigger={<Button>Open popover</Button>} label="Example popover">
          <p>Popover content</p>
        </Popover>
        <DropdownMenu
          trigger={<Button>Open menu</Button>}
          items={[
            { label: 'Rename', onSelect: () => {}, shortcut: 'F2' },
            'separator',
            { label: 'Delete', onSelect: () => {}, destructive: true },
          ]}
        />
        <Tooltip label="A short hint">
          <Button>Hover for a tooltip</Button>
        </Tooltip>
        <Button onClick={() => setDialog(true)}>Open dialog</Button>
        <Button onClick={() => showToast('Saved the rule')}>Show toast</Button>
        <Button onClick={() => showToast('Could not save', 'error')}>Show error toast</Button>
      </Section>

      <Section title="Command">
        <div className="glass rounded-lg p-2">
          <Command
            label="Search commands"
            groups={[
              {
                heading: 'Tasks',
                items: [
                  { value: 'plan', label: 'Plan sprint', onSelect: () => {} },
                  { value: 'ship', label: 'Ship release', onSelect: () => {} },
                ],
              },
            ]}
          />
        </div>
      </Section>

      <Section title="Badges">
        <StatusBadge name="To do" tone="todo" />
        <StatusBadge name="In progress" tone="progress" />
        <StatusBadge name="In review" tone="review" />
        <StatusBadge name="Done" tone="done" />
        <PriorityBadge name="Urgent" level="urgent" />
        <PriorityBadge name="High" level="high" />
        <PriorityBadge name="Normal" level="normal" />
        <PriorityBadge name="Low" level="low" />
        <StatusPill name="Existing status pill" />
        <AgentBadge />
        <AutomationBadge />
        <span>
          Press <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>
        </span>
      </Section>

      <Section title="Avatars">
        <Avatar name="Ada Lovelace" size={20} />
        <Avatar name="Grace Hopper" size={24} />
        <Avatar name="Alan Turing" size={32} />
      </Section>

      <Section title="Loading, empty and error">
        <div className="w-64">
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <EmptyState
          title="No tasks yet"
          description="Create the first task in this list."
          action={<Button variant="primary">New task</Button>}
        />
        <div className="w-80">
          <ErrorState message="Could not load the tasks." onRetry={() => {}} />
        </div>
      </Section>

      {dialog && (
        <Dialog title="Example dialog" onClose={() => setDialog(false)}>
          <p className="mb-3 text-muted">A dialog with a select inside it.</p>
          <label htmlFor="design-dialog-select" className="text-xs font-medium text-muted">
            Status in dialog
          </label>
          <Select
            id="design-dialog-select"
            value={status}
            onValueChange={setStatus}
            options={STATUSES}
          />
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={() => setDialog(false)}>
              Done
            </Button>
          </div>
        </Dialog>
      )}
    </main>
  )
}
