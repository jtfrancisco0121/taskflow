/**
 * The API binds task dates as Instants. A picked calendar day is sent as that day at 00:00 UTC and
 * shown in UTC, so a day never shifts with the viewer's time zone.
 */
const dayFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' })
const dateTimeFormat = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function toApiDate(day: string): string {
  return `${day}T00:00:00Z`
}

/** `YYYY-MM-DD` for a date input from an ISO instant (UTC day). */
export function toInputDay(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : ''
}

export function formatDay(iso: string | null | undefined): string {
  return iso ? dayFormat.format(new Date(iso)) : ''
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFormat.format(new Date(iso)) : ''
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return formatDay(iso)
}
