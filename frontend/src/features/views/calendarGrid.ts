/** CAL-1: Calendar days are UTC days; weeks start on Monday. All dates are `YYYY-MM-DD`. */
const DAY_MS = 86_400_000

export const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const fromDay = (day: string) => Date.parse(`${day}T00:00:00Z`)
export const addDays = (day: string, n: number) => toDay(fromDay(day) + n * DAY_MS)
export const todayUtc = () => toDay(Date.now())

/** Monday of the week containing the day. */
export function weekStart(day: string): string {
  const dow = (new Date(fromDay(day)).getUTCDay() + 6) % 7
  return addDays(day, -dow)
}

export type CalendarRange = { days: string[]; start: string; end: string; anchorMonth: string }

/** The visible days: whole weeks covering the month, or the one week of the anchor. */
export function calendarRange(mode: 'month' | 'week', anchor: string): CalendarRange {
  if (mode === 'week') {
    const start = weekStart(anchor)
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
    return { days, start, end: days[6], anchorMonth: anchor.slice(0, 7) }
  }
  const first = `${anchor.slice(0, 7)}-01`
  const nextMonth = new Date(fromDay(first))
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
  const last = addDays(toDay(nextMonth.getTime()), -1)
  const start = weekStart(first)
  const end = addDays(weekStart(last), 6)
  const count = (fromDay(end) - fromDay(start)) / DAY_MS + 1
  return {
    days: Array.from({ length: count }, (_, i) => addDays(start, i)),
    start,
    end,
    anchorMonth: anchor.slice(0, 7),
  }
}

/** The anchor after Previous or Next. */
export function shiftAnchor(mode: 'month' | 'week', anchor: string, direction: -1 | 1): string {
  if (mode === 'week') return addDays(anchor, 7 * direction)
  const d = new Date(fromDay(anchor))
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + direction)
  return toDay(d.getTime())
}

/** What a drop on a day sends: that day at 00:00 UTC. */
export const dueDateFor = (day: string) => `${day}T00:00:00Z`
