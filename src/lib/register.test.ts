import { describe, it, expect } from 'vitest'
import type { Account, BalanceEntry } from './types'
import {
  accountLedger,
  latestBalance,
  scopeLedger,
  registerChartSeries,
  matchAccountId,
  matchActivityType,
  normalizeDateInput,
  isDraftRowValid,
  ACTIVITY_SIGN,
  type DraftRow,
} from './register'

function mkEntry(overrides: Partial<BalanceEntry>): BalanceEntry {
  return {
    id: overrides.id || 'e' + Math.random(),
    accountId: 'acc-1',
    date: '2026-01-01',
    balance: 1000,
    activities: [],
    ...overrides,
  }
}

function mkAccount(overrides: Partial<Account>): Account {
  return {
    id: 'acc-1',
    accountNumber: '1234',
    name: 'Brokerage',
    institution: 'Fidelity',
    taxCategory: 'taxable',
    retirement: false,
    createdAt: '2026-01-01',
    ...overrides,
  }
}

describe('accountLedger', () => {
  it('returns [] for empty entries', () => {
    expect(accountLedger([], 'acc-1')).toEqual([])
  })

  it('single entry has null change/unexplained', () => {
    const rows = accountLedger([mkEntry({ id: 'e1', date: '2026-01-01', balance: 1000 })], 'acc-1')
    expect(rows).toHaveLength(1)
    expect(rows[0].change).toBeNull()
    expect(rows[0].unexplained).toBeNull()
    expect(rows[0].attributed).toBe(0)
  })

  it('two entries, no activities -> attributed=0, unexplained=change', () => {
    const entries = [
      mkEntry({ id: 'e1', date: '2026-01-01', balance: 1000, activities: [] }),
      mkEntry({ id: 'e2', date: '2026-02-01', balance: 1100, activities: [] }),
    ]
    const rows = accountLedger(entries, 'acc-1')
    expect(rows[1].change).toBe(100)
    expect(rows[1].attributed).toBe(0)
    expect(rows[1].unexplained).toBe(100)
  })

  it('two entries with Contribution -> attributed = amount, unexplained = change - amount', () => {
    const entries = [
      mkEntry({ id: 'e1', date: '2026-01-01', balance: 1000 }),
      mkEntry({
        id: 'e2',
        date: '2026-02-01',
        balance: 1150,
        activities: [{ type: 'Contribution', amount: 100, note: '' }],
      }),
    ]
    const rows = accountLedger(entries, 'acc-1')
    expect(rows[1].change).toBe(150)
    expect(rows[1].attributed).toBe(100)
    expect(rows[1].unexplained).toBe(50)
  })

  it('negative attributed for Withdrawal/Fee', () => {
    expect(ACTIVITY_SIGN.Withdrawal).toBe(-1)
    expect(ACTIVITY_SIGN.Fee).toBe(-1)
    const entries = [
      mkEntry({ id: 'e1', date: '2026-01-01', balance: 1000 }),
      mkEntry({
        id: 'e2',
        date: '2026-02-01',
        balance: 900,
        activities: [{ type: 'Withdrawal', amount: 150, note: '' }],
      }),
    ]
    const rows = accountLedger(entries, 'acc-1')
    expect(rows[1].attributed).toBe(-150)
    expect(rows[1].unexplained).toBe(-100 - -150)

    const feeEntries = [
      mkEntry({ id: 'e3', date: '2026-01-01', balance: 1000 }),
      mkEntry({ id: 'e4', date: '2026-02-01', balance: 995, activities: [{ type: 'Fee', amount: 5, note: '' }] }),
    ]
    const feeRows = accountLedger(feeEntries, 'acc-1')
    expect(feeRows[1].attributed).toBe(-5)
    expect(feeRows[1].unexplained).toBe(0)
  })

  it('two activities of opposite sign -> attributed = net sum, unexplained = change - attributed', () => {
    const entries = [
      mkEntry({ id: 'e1', date: '2026-01-01', balance: 1000 }),
      mkEntry({
        id: 'e2',
        date: '2026-02-01',
        balance: 1050,
        activities: [
          { type: 'Contribution', amount: 200, note: '' },
          { type: 'Withdrawal', amount: 50, note: '' },
        ],
      }),
    ]
    const rows = accountLedger(entries, 'acc-1')
    expect(rows[1].change).toBe(50)
    expect(rows[1].attributed).toBe(150)
    expect(rows[1].unexplained).toBe(-100)
  })

  it('empty activities array -> attributed=0, unexplained=change', () => {
    const entries = [
      mkEntry({ id: 'e1', date: '2026-01-01', balance: 1000 }),
      mkEntry({ id: 'e2', date: '2026-02-01', balance: 1100, activities: [] }),
    ]
    const rows = accountLedger(entries, 'acc-1')
    expect(rows[1].attributed).toBe(0)
    expect(rows[1].unexplained).toBe(rows[1].change)
  })

  it('activity with unknown type contributes 0, does not throw', () => {
    const entries = [
      mkEntry({ id: 'e1', date: '2026-01-01', balance: 1000 }),
      mkEntry({
        id: 'e2',
        date: '2026-02-01',
        balance: 1100,
        activities: [
          { type: 'None', amount: 25, note: '' },
          { type: 'Contribution', amount: 100, note: '' },
        ],
      }),
    ]
    expect(() => accountLedger(entries, 'acc-1')).not.toThrow()
    const rows = accountLedger(entries, 'acc-1')
    expect(rows[1].attributed).toBe(100)
  })
})

describe('latestBalance', () => {
  it('returns null for empty entries', () => {
    expect(latestBalance([], 'acc-1')).toBeNull()
  })

  it('picks max date, not max insertion order', () => {
    const entries = [
      mkEntry({ id: 'e1', date: '2026-03-01', balance: 300 }),
      mkEntry({ id: 'e2', date: '2026-01-01', balance: 100 }),
      mkEntry({ id: 'e3', date: '2026-02-01', balance: 200 }),
    ]
    const result = latestBalance(entries, 'acc-1')
    expect(result?.id).toBe('e1')
    expect(result?.balance).toBe(300)
  })
})

describe('scopeLedger', () => {
  it('unions multiple accounts', () => {
    const entries = [
      mkEntry({ id: 'e1', accountId: 'acc-1', date: '2026-01-01' }),
      mkEntry({ id: 'e2', accountId: 'acc-2', date: '2026-01-02' }),
    ]
    const rows = scopeLedger(entries, ['acc-1', 'acc-2'], 'All')
    expect(rows).toHaveLength(2)
  })

  it('With Activity filter drops rows with no activities', () => {
    const entries = [
      mkEntry({ id: 'e1', accountId: 'acc-1', date: '2026-01-01', activities: [] }),
      mkEntry({
        id: 'e2',
        accountId: 'acc-1',
        date: '2026-02-01',
        activities: [{ type: 'Contribution', amount: 50, note: '' }],
      }),
    ]
    const rows = scopeLedger(entries, ['acc-1'], 'With Activity')
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('e2')
  })

  it('sorts by date desc then accountId tiebreak', () => {
    const entries = [
      mkEntry({ id: 'e1', accountId: 'acc-b', date: '2026-01-01' }),
      mkEntry({ id: 'e2', accountId: 'acc-a', date: '2026-01-01' }),
      mkEntry({ id: 'e3', accountId: 'acc-a', date: '2026-02-01' }),
    ]
    const rows = scopeLedger(entries, ['acc-a', 'acc-b'], 'All')
    expect(rows.map((r) => r.id)).toEqual(['e3', 'e2', 'e1'])
  })
})

describe('registerChartSeries', () => {
  it('single entry -> single point at x = width/2 (500)', () => {
    const entries = [mkEntry({ id: 'e1', accountId: 'acc-1', date: '2026-01-01', balance: 1000 })]
    const series = registerChartSeries(entries, ['acc-1'])
    expect(series.dots).toHaveLength(1)
    expect(series.dots[0].x).toBe(500)
  })

  it('time-scales X by elapsed ms, not by index (uneven gaps)', () => {
    const entries = [
      mkEntry({ id: 'e1', accountId: 'acc-1', date: '2026-01-01', balance: 1000 }),
      mkEntry({ id: 'e2', accountId: 'acc-1', date: '2026-01-02', balance: 1050 }),
      mkEntry({ id: 'e3', accountId: 'acc-1', date: '2026-12-31', balance: 1200 }),
    ]
    const series = registerChartSeries(entries, ['acc-1'])
    expect(series.dots).toHaveLength(3)
    // Index-based scaling would put the middle point at x=500 (50%).
    // Time-based scaling should push it very close to x=0 since the gap
    // between entry 1 and 2 is tiny compared to the gap between 2 and 3.
    expect(series.dots[1].x).not.toBe(500)
    expect(series.dots[1].x).toBeLessThan(50)
  })

  it('flat balances use 5%-of-max fallback padding, not 15%-of-zero-range', () => {
    const entries = [
      mkEntry({ id: 'e1', accountId: 'acc-1', date: '2026-01-01', balance: 1000 }),
      mkEntry({ id: 'e2', accountId: 'acc-1', date: '2026-02-01', balance: 1000 }),
    ]
    const series = registerChartSeries(entries, ['acc-1'])
    // yMin = max(0, 1000 - 1000*0.05) = 950, yMax = 1000 + 50 = 1050
    // top label (f=1, i.e. v = yMin) should be $950.00, bottom (f=0, v=yMax) should be $1,050.00
    const topLabel = series.yLabels.find((l) => l.topPct === 100)
    const bottomLabel = series.yLabels.find((l) => l.topPct === 0)
    expect(topLabel?.label).toBe('$950.00')
    expect(bottomLabel?.label).toBe('$1,050.00')
  })
})

describe('matchAccountId', () => {
  const accounts = [
    mkAccount({ id: 'acc-1', name: 'Brokerage', institution: 'Fidelity', accountNumber: '1234' }),
    mkAccount({ id: 'acc-2', name: 'Roth IRA', institution: 'Vanguard', accountNumber: '5678' }),
  ]

  it('matches by id', () => {
    expect(matchAccountId('acc-1', accounts)).toBe('acc-1')
  })

  it('matches by name exact', () => {
    expect(matchAccountId('Roth IRA', accounts)).toBe('acc-2')
  })

  it('matches by name substring (value contains name)', () => {
    expect(matchAccountId('My Roth IRA Account', accounts)).toBe('acc-2')
  })

  it('matches by name substring (name contains value)', () => {
    const wide = [mkAccount({ id: 'acc-3', name: 'Fidelity Brokerage Taxable', institution: 'Fidelity' })]
    expect(matchAccountId('Brokerage', wide)).toBe('acc-3')
  })

  it('matches by accountNumber', () => {
    expect(matchAccountId('5678', accounts)).toBe('acc-2')
  })

  it('no match returns empty string', () => {
    expect(matchAccountId('nonexistent xyz', accounts)).toBe('')
  })
})

describe('matchActivityType', () => {
  it('exact match', () => {
    expect(matchActivityType('Contribution')).toBe('Contribution')
    expect(matchActivityType('withdrawal')).toBe('Withdrawal')
  })

  it('prefix match', () => {
    expect(matchActivityType('contrib')).toBe('Contribution')
  })

  it('no match returns None', () => {
    expect(matchActivityType('zzz')).toBe('None')
    expect(matchActivityType('')).toBe('None')
  })
})

describe('normalizeDateInput', () => {
  it('valid date string -> YYYY-MM-DD', () => {
    // Use a noon timestamp so the local-timezone offset applied inside
    // normalizeDateInput can't roll the date over to the previous/next day.
    expect(normalizeDateInput('2026-03-15T12:00:00')).toBe('2026-03-15')
    expect(normalizeDateInput('March 15, 2026 12:00:00')).toBe('2026-03-15')
  })

  it('garbage input -> empty string', () => {
    expect(normalizeDateInput('not a date')).toBe('')
  })
})

describe('isDraftRowValid', () => {
  const validRow: DraftRow = {
    key: 'k1',
    date: '2026-01-01',
    accountId: 'acc-1',
    balance: '1000',
    activities: [],
  }

  it('valid row -> true', () => {
    expect(isDraftRowValid(validRow)).toBe(true)
  })

  it('missing date -> false', () => {
    expect(isDraftRowValid({ ...validRow, date: '' })).toBe(false)
  })

  it('missing account -> false', () => {
    expect(isDraftRowValid({ ...validRow, accountId: '' })).toBe(false)
  })

  it('missing balance -> false', () => {
    expect(isDraftRowValid({ ...validRow, balance: '' })).toBe(false)
  })

  it('NaN balance -> false', () => {
    expect(isDraftRowValid({ ...validRow, balance: 'abc' })).toBe(false)
  })
})
