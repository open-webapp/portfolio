import type { Account, ActivityType, BalanceEntry } from './types'
import { fmtUSD } from './computations'
import { parseCsvNumber } from './csv'
import { uid } from './seed'

export const ACTIVITY_TYPES: ActivityType[] = [
  'None',
  'Contribution',
  'Withdrawal',
  'Transfer In',
  'Transfer Out',
  'Dividend',
  'Fee',
]

export const ACTIVITY_SIGN: Partial<Record<ActivityType, 1 | -1>> = {
  Contribution: 1,
  'Transfer In': 1,
  Dividend: 1,
  Withdrawal: -1,
  'Transfer Out': -1,
  Fee: -1,
}

export const BALANCE_FIELD_HINTS: { key: string; hints: string[] }[] = [
  { key: 'date', hints: ['date', 'as of', 'period'] },
  { key: 'accountId', hints: ['account', 'name'] },
  { key: 'balance', hints: ['balance', 'value', 'total'] },
  { key: 'activityType', hints: ['activity', 'type', 'reason'] },
  { key: 'activityAmount', hints: ['amount', 'contribution'] },
  { key: 'note', hints: ['note', 'memo', 'comment'] },
]

export interface LedgerRow extends BalanceEntry {
  change: number | null
  attributed: number
  unexplained: number | null
}

export interface DraftActivity {
  key: string
  type: string
  amount: string
  note: string
}

export interface DraftRow {
  key: string
  date: string
  accountId: string
  balance: string
  activities: DraftActivity[]
}

export function accountLedger(entries: BalanceEntry[], accountId: string): LedgerRow[] {
  const rows = entries
    .filter((e) => e.accountId === accountId)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
  return rows.map((e, i) => {
    const change = i === 0 ? null : e.balance - rows[i - 1].balance
    const attributed = e.activities.reduce(
      (sum, a) => sum + (ACTIVITY_SIGN[a.type as ActivityType] ?? 0) * (a.amount || 0),
      0,
    )
    return { ...e, change, attributed, unexplained: change === null ? null : change - attributed }
  })
}

export function latestBalance(entries: BalanceEntry[], accountId: string): BalanceEntry | null {
  const rows = entries
    .filter((e) => e.accountId === accountId)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
  return rows.length ? rows[rows.length - 1] : null
}

export function scopeLedger(
  entries: BalanceEntry[],
  scopeAccountIds: string[],
  activityFilter: 'All' | 'With Activity',
): LedgerRow[] {
  let rows: LedgerRow[] = []
  scopeAccountIds.forEach((id) => {
    rows = rows.concat(accountLedger(entries, id))
  })
  if (activityFilter === 'With Activity') rows = rows.filter((r) => r.activities.length > 0)
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.accountId.localeCompare(b.accountId))
}

export interface RegisterChartSeries {
  points: string
  area: string
  dots: { x: number; y: number; title: string }[]
  yLabels: { y: number; topPct: number; label: string }[]
  xLabels: { leftPct: number; label: string }[]
}

const dateStr = (d: string): string =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function registerChartSeries(entries: BalanceEntry[], scopeAccountIds: string[]): RegisterChartSeries {
  const W = 1000
  const H = 200

  let fullLedger: LedgerRow[] = []
  scopeAccountIds.forEach((id) => {
    fullLedger = fullLedger.concat(accountLedger(entries, id))
  })

  const dates = Array.from(new Set(fullLedger.map((r) => r.date))).sort()
  const series = dates.map((d) => {
    const total = scopeAccountIds.reduce((s, id) => {
      const rows = entries
        .filter((e) => e.accountId === id && e.date <= d)
        .sort((x, y) => x.date.localeCompare(y.date))
      return s + (rows.length ? rows[rows.length - 1].balance : 0)
    }, 0)
    return { date: d, t: Date.parse(d + 'T00:00:00'), total }
  })

  const vals = series.map((s) => s.total)
  const rawMax = vals.length ? Math.max(...vals) : 1
  const rawMin = vals.length ? Math.min(...vals) : 0
  const pad = (rawMax - rawMin) * 0.15 || Math.max(1, rawMax * 0.05)
  const yMax = rawMax + pad
  const yMin = Math.max(0, rawMin - pad)

  const t0 = series.length ? series[0].t : 0
  const tSpan = series.length > 1 ? series[series.length - 1].t - t0 : 1
  const xOf = (s: { t: number }): number => (series.length > 1 ? ((s.t - t0) / tSpan) * W : W / 2)
  const yOf = (v: number): number => H - ((v - yMin) / (yMax - yMin || 1)) * H

  const pts = series.map((s) => ({ x: xOf(s), y: yOf(s.total), s }))
  const points = pts.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')
  const area = pts.length
    ? pts[0].x.toFixed(1) + ',' + H + ' ' + points + ' ' + pts[pts.length - 1].x.toFixed(1) + ',' + H
    : ''
  const dots = pts.map((p) => ({
    x: parseFloat(p.x.toFixed(1)),
    y: parseFloat(p.y.toFixed(1)),
    title: dateStr(p.s.date) + ' — ' + fmtUSD(p.s.total),
  }))

  const yLabels = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = yMin + (yMax - yMin) * (1 - f)
    return { y: parseFloat((H * f).toFixed(1)), topPct: parseFloat((f * 100).toFixed(2)), label: fmtUSD(Math.round(v)) }
  })

  const tickCount = Math.min(6, series.length)
  const xLabels =
    series.length <= 1
      ? series.map((s) => ({ leftPct: 50, label: dateStr(s.date) }))
      : Array.from({ length: tickCount }, (_, i) => {
          const s = series[Math.round((i / (tickCount - 1)) * (series.length - 1))]
          return {
            leftPct: parseFloat(((xOf(s) / W) * 100).toFixed(2)),
            label: new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
          }
        })

  return { points, area, dots, yLabels, xLabels }
}

export function matchAccountId(value: string, accounts: Account[]): string {
  const v = (value || '').trim().toLowerCase()
  if (!v) return ''
  const hit = accounts.find(
    (a) =>
      a.id.toLowerCase() === v ||
      a.name.toLowerCase() === v ||
      a.accountNumber === v ||
      (a.institution + ' — ' + a.name).toLowerCase() === v ||
      a.name.toLowerCase().includes(v) ||
      v.includes(a.name.toLowerCase()),
  )
  return hit ? hit.id : ''
}

export function matchActivityType(value: string): ActivityType {
  const v = (value || '').trim().toLowerCase()
  if (!v) return 'None'
  return (
    (ACTIVITY_TYPES.find((t) => t.toLowerCase() === v) as ActivityType | undefined) ||
    (ACTIVITY_TYPES.find((t) => t.toLowerCase().startsWith(v)) as ActivityType | undefined) ||
    'None'
  )
}

export function normalizeDateInput(value: string): string {
  const t = Date.parse(value)
  if (isNaN(t)) return ''
  const d = new Date(t)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export function emptyDraftRow(): DraftRow {
  return { key: uid('brow'), date: '', accountId: '', balance: '', activities: [] }
}

export function isDraftRowValid(row: DraftRow): boolean {
  return !!row.date && !!row.accountId && row.balance !== '' && !isNaN(parseCsvNumber(row.balance))
}
