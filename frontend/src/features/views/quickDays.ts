const DAY = 86_400_000
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Today, tomorrow and next Monday as UTC `YYYY-MM-DD` days (decision: task dates are UTC days). */
export function quickDays(now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const toMonday = (8 - new Date(today).getUTCDay()) % 7 || 7
  return {
    today: utcDay(today),
    tomorrow: utcDay(today + DAY),
    nextWeek: utcDay(today + toMonday * DAY),
  }
}
