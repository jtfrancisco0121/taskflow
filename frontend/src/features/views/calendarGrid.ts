/**
 * CAL-1 (revised, slice 8): the Calendar's days are the viewer's LOCAL days; weeks start on Monday. All dates are
 * `YYYY-MM-DD`. The day arithmetic never goes through a millisecond count (a DST day is not 24 hours), only through
 * calendar fields. A stored due date keeps the API contract: a picked day is the instant `YYYY-MM-DDT00:00:00Z`
 * (ADR 003 decision 4), and that instant sits on the day it names whatever the viewer's zone is.
 */
const pad = (n: number) => String(n).padStart(2, '0')

/** A local Date at noon of the day (noon keeps every DST shift inside the same date). */
export const fromDay = (day: string) =>
  new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 12)
export const toDay = (d: Date) =>
  `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const addDays = (day: string, n: number) => {
  const d = fromDay(day)
  d.setDate(d.getDate() + n)
  return toDay(d)
}
/** Today in the viewer's zone. */
export const todayLocal = () => toDay(new Date())

/** The whole days from `a` to `b` (both `YYYY-MM-DD`). */
const daysBetween = (a: string, b: string) => {
  const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
  return Math.round((ms(b) - ms(a)) / 86_400_000)
}

/** Monday of the week containing the day. */
export function weekStart(day: string): string {
  return addDays(day, -((fromDay(day).getDay() + 6) % 7))
}

/**
 * The calendar day a due date sits on. The API's own form, midnight UTC, names its day outright (so a stored day
 * never shifts with the zone); any other instant (set by an agent or an import) is shown on its local day.
 */
export function dayOfDue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const midnightUtc =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  return midnightUtc ? d.toISOString().slice(0, 10) : toDay(d)
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
  const last = addDays(shiftAnchor('month', first, 1), -1)
  const start = weekStart(first)
  const end = addDays(weekStart(last), 6)
  const count = daysBetween(start, end) + 1
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
  const d = fromDay(anchor)
  d.setDate(1)
  d.setMonth(d.getMonth() + direction)
  return toDay(d)
}

/** What a drop on a day sends: that day at 00:00 UTC, the API's date form. */
export const dueDateFor = (day: string) => `${day}T00:00:00Z`
