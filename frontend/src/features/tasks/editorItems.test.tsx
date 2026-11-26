import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  AssigneesValue,
  assigneeItems,
  dayItems,
  dayOfItem,
  priorityItems,
  quickDays,
  statusItems,
} from './editorItems'

describe('editor items', () => {
  it('computes the quick days in UTC', () => {
    expect(quickDays(new Date('2026-11-26T23:30:00Z'))).toEqual({
      today: '2026-11-26',
      tomorrow: '2026-11-27',
      nextWeek: '2026-11-30',
    })
    // Monday: next week is seven days later; Sunday: the next day.
    expect(quickDays(new Date('2026-11-30T00:00:00Z')).nextWeek).toBe('2026-12-07')
    expect(quickDays(new Date('2026-11-29T10:00:00Z')).nextWeek).toBe('2026-11-30')
  })

  it('offers Today, Tomorrow, Next week and No date and maps them to API days', () => {
    const days = quickDays(new Date('2026-11-26T10:00:00Z'))
    expect(dayItems(days).map((i) => i.label)).toEqual([
      'Today',
      'Tomorrow',
      'Next week',
      'No date',
    ])
    expect(dayOfItem('tomorrow', days)).toBe('2026-11-27T00:00:00Z')
    expect(dayOfItem('next-week', days)).toBe('2026-11-30T00:00:00Z')
    expect(dayOfItem('none', days)).toBeNull()
  })

  it('names status, priority and assignee items by their label', () => {
    expect(
      statusItems([{ id: 's1', name: 'In progress', group: 'ACTIVE' }]).map((i) => i.label),
    ).toEqual(['In progress'])
    expect(priorityItems().map((i) => i.label)).toEqual(['Urgent', 'High', 'Normal', 'Low', 'None'])
    expect(
      assigneeItems([
        { userId: 'u1', displayName: 'Ada' },
        { userId: 'u2', email: 'b@x.io' },
      ]).map((i) => i.label),
    ).toEqual(['Ada', 'b@x.io'])
  })

  it('shows a dash for no assignees and a former member for an unknown one', () => {
    const { rerender } = render(<AssigneesValue ids={[]} names={new Map()} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    rerender(<AssigneesValue ids={['gone']} names={new Map()} />)
    expect(screen.getByRole('img', { name: 'Former member' })).toBeInTheDocument()
  })
})
