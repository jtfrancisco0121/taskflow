export type Shortcut = {
  group: 'Global' | 'List' | 'Task'
  /** What the sheet shows, one chip per entry. */
  keys: string[]
  /** The `KeyboardEvent.key` values the handler reacts to (the consistency test compares them with the code). */
  handles: string[]
  description: string
}

/**
 * AD-9: every keyboard shortcut of the app, in one list. The sheet opened by `?` renders it, and a test fails when
 * a key handled by the List, the palette or the search box is missing here.
 */
export const SHORTCUTS: Shortcut[] = [
  {
    group: 'Global',
    keys: ['Ctrl/⌘', 'K'],
    handles: ['k'],
    description: 'Open the command palette',
  },
  { group: 'Global', keys: ['/'], handles: ['/'], description: 'Search tasks' },
  { group: 'Global', keys: ['?'], handles: ['?'], description: 'Show these shortcuts' },
  {
    group: 'Global',
    keys: ['Esc'],
    handles: ['Escape'],
    description: 'Close the open layer or clear the selection',
  },
  { group: 'List', keys: ['j', '↓'], handles: ['j', 'ArrowDown'], description: 'Next task' },
  { group: 'List', keys: ['k', '↑'], handles: ['k', 'ArrowUp'], description: 'Previous task' },
  {
    group: 'Task',
    keys: ['j', '↓'],
    handles: ['j', 'ArrowDown'],
    description: 'Next task of the List',
  },
  {
    group: 'Task',
    keys: ['k', '↑'],
    handles: ['k', 'ArrowUp'],
    description: 'Previous task of the List',
  },
  { group: 'List', keys: ['x'], handles: ['x'], description: 'Select or unselect the task' },
  { group: 'List', keys: ['Enter'], handles: ['Enter'], description: 'Open the task' },
  { group: 'List', keys: ['s'], handles: ['s'], description: 'Set the status' },
  { group: 'List', keys: ['p'], handles: ['p'], description: 'Set the priority' },
  { group: 'List', keys: ['a'], handles: ['a'], description: 'Set the assignees' },
  { group: 'List', keys: ['d'], handles: ['d'], description: 'Set the due date' },
  {
    group: 'List',
    keys: ['Backspace', 'Del'],
    handles: ['Backspace', 'Delete'],
    description: 'Move the task or the selection to trash',
  },
]
