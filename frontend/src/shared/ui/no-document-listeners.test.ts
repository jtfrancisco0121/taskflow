// @vitest-environment node
import { describe, expect, it } from 'vitest'

// AD-7: the shell menus rely on the library (Radix) for outside-click and Escape, not their own listeners.
describe('shell menus have no hand-made document or window listeners', () => {
  const files = import.meta.glob(
    [
      '../../features/workspace/WorkspaceSwitcher.tsx',
      '../../features/notifications/NotificationBell.tsx',
      '../../features/locations/TreeItemMenu.tsx',
    ],
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, string>

  it('scans the three files', () => {
    expect(Object.keys(files)).toHaveLength(3)
  })

  it('has no addEventListener on document or window', () => {
    const offenders = Object.entries(files)
      .filter(([, source]) => /\b(document|window)\.addEventListener\b/.test(source))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})
