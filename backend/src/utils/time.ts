export function localDateKey(value: Date = new Date()): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function localDayRangeIso(dateKey: string): { startIso: string; endIso: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) {
    throw new Error(`日期键无效（应为 YYYY-MM-DD）：${dateKey}`)
  }
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const start = new Date(year, month, day, 0, 0, 0, 0)
  const end = new Date(year, month, day + 1, 0, 0, 0, 0)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

export function isoOnLocalDate(iso: string | undefined, dateKey: string): boolean {
  if (!iso) return false
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return false
  return localDateKey(value) === dateKey
}
