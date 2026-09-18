import { describe, it, expect } from 'vitest'
import { computePosition, allocationByAssetClass, fmtUSD, fmtPct, fmtPortfolioPercent, glColor, GAIN_COLOR, LOSS_COLOR, toMonthly, toYearly, toPeriod, DEFAULT_CATEGORIES, parseBudgetTransactionsCsv, parseOfxTransactions } from './computations'
import { Position } from './types'

describe('computations', () => {
  // Test 1: computePosition basic math
  it('computePosition: computes marketValue, costBasis, gl, glPct correctly', () => {
    const position: Position = {
      id: 'pos-1',
      accountId: 'acc-1',
      symbol: 'AAPL',
      name: 'Apple Inc.',
      assetClass: 'Equity',
      shares: 100,
      avgCost: 150,
      price: 200,
      lastImportedAt: '2026-08-08'
    }

    const result = computePosition(position)

    expect(result.marketValue).toBe(20000) // 100 * 200
    expect(result.costBasis).toBe(15000) // 100 * 150
    expect(result.gl).toBe(5000) // 20000 - 15000
    expect(result.glPct).toBe((5000 / 15000) * 100) // ~33.33%
  })

  // Test 2: costBasis === 0 → glPct === 0 (no divide-by-zero)
  it('computePosition: handles costBasis === 0 without divide-by-zero', () => {
    const position: Position = {
      id: 'pos-2',
      accountId: 'acc-1',
      symbol: 'CASH',
      name: 'Cash',
      assetClass: 'Cash',
      shares: 1,
      avgCost: 0,
      price: 100,
      lastImportedAt: '2026-08-08'
    }

    const result = computePosition(position)

    expect(result.marketValue).toBe(100) // 1 * 100
    expect(result.costBasis).toBe(0) // 1 * 0
    expect(result.gl).toBe(100) // 100 - 0
    expect(result.glPct).toBe(0) // Should be 0, not NaN or Infinity
  })

  // Test 3: negative gl → glPct negative
  it('computePosition: handles negative gl and glPct correctly', () => {
    const position: Position = {
      id: 'pos-3',
      accountId: 'acc-1',
      symbol: 'TSLA',
      name: 'Tesla Inc.',
      assetClass: 'Equity',
      shares: 50,
      avgCost: 200,
      price: 150,
      lastImportedAt: '2026-08-08'
    }

    const result = computePosition(position)

    expect(result.marketValue).toBe(7500) // 50 * 150
    expect(result.costBasis).toBe(10000) // 50 * 200
    expect(result.gl).toBe(-2500) // 7500 - 10000
    expect(result.glPct).toBe((-2500 / 10000) * 100) // -25%
  })

  // Test 4: allocationByAssetClass groups and calculates percentages
  it('allocationByAssetClass: groups by asset class and calculates percentages', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft Corp.',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-3',
        accountId: 'acc-1',
        symbol: 'BND',
        name: 'Bond ETF',
        assetClass: 'Fixed Income',
        shares: 200,
        avgCost: 50,
        price: 50,
        lastImportedAt: '2026-08-08'
      }
    ]

    const result = allocationByAssetClass(positions)

    // Total market value: (100*200) + (50*400) + (200*50) = 20000 + 20000 + 10000 = 50000
    // Equity: 40000, Fixed Income: 10000
    expect(result).toHaveLength(2)

    const equity = result.find(r => r.label === 'Equity')!
    const fixedIncome = result.find(r => r.label === 'Fixed Income')!

    expect(equity.value).toBe(40000)
    expect(equity.pct).toBe(80) // 40000 / 50000 * 100

    expect(fixedIncome.value).toBe(10000)
    expect(fixedIncome.pct).toBe(20) // 10000 / 50000 * 100

    // Verify percentages sum to 100 (within float epsilon)
    const sum = result.reduce((acc, r) => acc + r.pct, 0)
    expect(sum).toBeCloseTo(100, 5)
  })

  // Test 5: allocationByAssetClass with empty positions → empty result, no NaN
  it('allocationByAssetClass: handles empty positions without NaN', () => {
    const result = allocationByAssetClass([])

    expect(result).toEqual([])
    expect(result.every(r => !isNaN(r.pct))).toBe(true)
  })

  // Test 6: fmtUSD/fmtPct format exactly as prototype
  it('fmtUSD: formats correctly with negative signs and decimals', () => {
    expect(fmtUSD(1234.56)).toBe('$1,234.56')
    expect(fmtUSD(-5.00)).toBe('-$5.00')
    expect(fmtUSD(0)).toBe('$0.00')
    expect(fmtUSD(-1234.567)).toBe('-$1,234.57') // Should round
    expect(fmtUSD(1000000)).toBe('$1,000,000.00')
  })

  it('fmtPct: formats correctly with sign and 2 decimals', () => {
    expect(fmtPct(1.2)).toBe('+1.20%')
    expect(fmtPct(-1.2)).toBe('-1.20%')
    expect(fmtPct(0)).toBe('+0.00%')
    expect(fmtPct(33.333)).toBe('+33.33%')
    expect(fmtPct(-25)).toBe('-25.00%')
  })

  it('fmtPortfolioPercent: formats value as percentage of total with 1 decimal', () => {
    expect(fmtPortfolioPercent(12.345, 100)).toBe('12.3%')
    expect(fmtPortfolioPercent(-5, 100)).toBe('-5.0%')
    expect(fmtPortfolioPercent(0.5, 100)).toBe('0.5%')
  })

  it('fmtPortfolioPercent: returns dash for zero or negative total', () => {
    expect(fmtPortfolioPercent(50, 0)).toBe('—')
    expect(fmtPortfolioPercent(50, -10)).toBe('—')
  })

  // Additional validation: allocationByAssetClass with zero-value positions
  it('allocationByAssetClass: sums to 100% even with multiple asset classes', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'VTI',
        name: 'Vanguard Total Stock',
        assetClass: 'ETF',
        shares: 100,
        avgCost: 100,
        price: 300,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'BND',
        name: 'Bond ETF',
        assetClass: 'Fixed Income',
        shares: 100,
        avgCost: 50,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-3',
        accountId: 'acc-1',
        symbol: 'GLD',
        name: 'Gold ETF',
        assetClass: 'Commodity',
        shares: 100,
        avgCost: 200,
        price: 200,
        lastImportedAt: '2026-08-08'
      }
    ]

    const result = allocationByAssetClass(positions)

    // Total: (100*300) + (100*200) + (100*200) = 30000 + 20000 + 20000 = 70000
    // ETF: 30000 (42.86%), Fixed Income: 20000 (28.57%), Commodity: 20000 (28.57%)
    const percentSum = result.reduce((acc, r) => acc + r.pct, 0)
    expect(percentSum).toBeCloseTo(100, 5)
  })

  describe('glColor', () => {
    it('returns GAIN_COLOR for positive gains', () => {
      expect(glColor(100)).toBe(GAIN_COLOR)
      expect(glColor(0.01)).toBe(GAIN_COLOR)
    })

    it('returns LOSS_COLOR for negative losses', () => {
      expect(glColor(-1)).toBe(LOSS_COLOR)
      expect(glColor(-1000)).toBe(LOSS_COLOR)
    })

    it('returns GAIN_COLOR for zero (>= 0 tie-break)', () => {
      expect(glColor(0)).toBe(GAIN_COLOR)
    })
  })

  describe('toMonthly', () => {
    it('returns the amount unchanged for monthly frequency', () => {
      expect(toMonthly(100, 'monthly')).toBe(100)
    })

    it('divides by 12 for yearly frequency', () => {
      expect(toMonthly(1200, 'yearly')).toBe(100)
    })
  })

  describe('toYearly', () => {
    it('returns the amount unchanged for yearly frequency', () => {
      expect(toYearly(1200, 'yearly')).toBe(1200)
    })

    it('multiplies by 12 for monthly frequency', () => {
      expect(toYearly(100, 'monthly')).toBe(1200)
    })
  })

  describe('toPeriod', () => {
    it('monthly period + monthly freq => amount unchanged', () => {
      expect(toPeriod(100, 'monthly', 'monthly')).toBe(100)
    })

    it('monthly period + yearly freq => divides by 12', () => {
      expect(toPeriod(1200, 'yearly', 'monthly')).toBe(100)
    })

    it('yearly period + monthly freq => multiplies by 12', () => {
      expect(toPeriod(100, 'monthly', 'yearly')).toBe(1200)
    })

    it('yearly period + yearly freq => amount unchanged', () => {
      expect(toPeriod(1200, 'yearly', 'yearly')).toBe(1200)
    })
  })

  describe('DEFAULT_CATEGORIES', () => {
    it('has exactly 11 entries in the documented order, ending with Other', () => {
      expect(DEFAULT_CATEGORIES).toEqual([
        'Housing', 'Utilities', 'Groceries', 'Transportation', 'Insurance',
        'Subscriptions', 'Health', 'Entertainment', 'Debt/Loans', 'Savings', 'Other',
      ])
      expect(DEFAULT_CATEGORIES.length).toBe(11)
      expect(DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1]).toBe('Other')
    })
  })

  describe('parseBudgetTransactionsCsv', () => {
    it('parses 3 valid rows with no header', () => {
      const csv = [
        '2026-01-01,Coffee,-4.50',
        '2026-01-02,Paycheck,2000',
        '2026-01-03,Rent,-1500',
      ].join('\n')
      const result = parseBudgetTransactionsCsv(csv)
      expect(result).toEqual([
        { date: '2026-01-01', description: 'Coffee', amount: -4.5 },
        { date: '2026-01-02', description: 'Paycheck', amount: 2000 },
        { date: '2026-01-03', description: 'Rent', amount: -1500 },
      ])
    })

    it('drops a real header row (last field non-numeric)', () => {
      const csv = [
        'Date,Description,Amount',
        '2026-01-01,Coffee,-4.50',
        '2026-01-02,Paycheck,2000',
      ].join('\n')
      const result = parseBudgetTransactionsCsv(csv)
      expect(result).toEqual([
        { date: '2026-01-01', description: 'Coffee', amount: -4.5 },
        { date: '2026-01-02', description: 'Paycheck', amount: 2000 },
      ])
    })

    it('known quirk: drops first data row when its amount field is non-numeric, mistaking it for a header', () => {
      const csv = [
        '2026-01-01,Coffee,N/A',
        '2026-01-02,Paycheck,2000',
      ].join('\n')
      const result = parseBudgetTransactionsCsv(csv)
      // The first row is dropped as a "header" even though it was real data —
      // this is the documented behavior of the spec algorithm, not a bug.
      expect(result).toEqual([
        { date: '2026-01-02', description: 'Paycheck', amount: 2000 },
      ])
    })

    it('skips a line with fewer than 3 comma-separated parts', () => {
      const csv = [
        '2026-01-01,Coffee,-4.50',
        '2026-01-02,Incomplete',
        '2026-01-03,Rent,-1500',
      ].join('\n')
      const result = parseBudgetTransactionsCsv(csv)
      expect(result).toEqual([
        { date: '2026-01-01', description: 'Coffee', amount: -4.5 },
        { date: '2026-01-03', description: 'Rent', amount: -1500 },
      ])
    })

    it('skips rows with missing date or non-numeric amount', () => {
      const csv = [
        '2026-01-01,Coffee,-4.50',
        ',NoDate,-5.00',
        '2026-01-04,BadAmount,abc',
        '2026-01-03,Rent,-1500',
      ].join('\n')
      const result = parseBudgetTransactionsCsv(csv)
      expect(result).toEqual([
        { date: '2026-01-01', description: 'Coffee', amount: -4.5 },
        { date: '2026-01-03', description: 'Rent', amount: -1500 },
      ])
    })

    it('ignores blank/whitespace-only lines', () => {
      const csv = [
        '2026-01-01,Coffee,-4.50',
        '',
        '   ',
        '2026-01-03,Rent,-1500',
      ].join('\n')
      const result = parseBudgetTransactionsCsv(csv)
      expect(result).toEqual([
        { date: '2026-01-01', description: 'Coffee', amount: -4.5 },
        { date: '2026-01-03', description: 'Rent', amount: -1500 },
      ])
    })

    it('normalizes an ISO date (passthrough)', () => {
      const csv = '2026-09-17,Coffee,-4.50'
      const result = parseBudgetTransactionsCsv(csv)
      expect(result).toEqual([{ date: '2026-09-17', description: 'Coffee', amount: -4.5 }])
    })

    it('normalizes MM/DD/YYYY', () => {
      const csv = '09/17/2026,Coffee,-4.50'
      const result = parseBudgetTransactionsCsv(csv)
      expect(result).toEqual([{ date: '2026-09-17', description: 'Coffee', amount: -4.5 }])
    })

    it('normalizes single-digit M/D/YYYY', () => {
      const csv = '9/7/2026,Coffee,-4.50'
      const result = parseBudgetTransactionsCsv(csv)
      expect(result).toEqual([{ date: '2026-09-07', description: 'Coffee', amount: -4.5 }])
    })

    it('normalizes MM-DD-YYYY', () => {
      const csv = '09-17-2026,Coffee,-4.50'
      const result = parseBudgetTransactionsCsv(csv)
      expect(result).toEqual([{ date: '2026-09-17', description: 'Coffee', amount: -4.5 }])
    })

    it('normalizes abbreviated month name "Sep 17 2026" (no comma, since the crude comma-split parser cannot carry an embedded comma inside a field)', () => {
      const csv = 'Sep 17 2026,Coffee,-4.50'
      const result = parseBudgetTransactionsCsv(csv)
      expect(result).toEqual([{ date: '2026-09-17', description: 'Coffee', amount: -4.5 }])
    })

    it('normalizes full month name "September 17 2026" (no comma, same parser constraint)', () => {
      const csv = 'September 17 2026,Coffee,-4.50'
      const result = parseBudgetTransactionsCsv(csv)
      expect(result).toEqual([{ date: '2026-09-17', description: 'Coffee', amount: -4.5 }])
    })

    it('treats ambiguous MM/DD/YYYY as month-first even when both parts <=12 (no swap)', () => {
      const csv = '03/04/2026,Coffee,-4.50'
      const result = parseBudgetTransactionsCsv(csv)
      // March 4, NOT April 3 -- no DD/MM auto-detection/swap
      expect(result).toEqual([{ date: '2026-03-04', description: 'Coffee', amount: -4.5 }])
    })

    it('drops a row whose slash-date month part is >12', () => {
      const csv = '13/40/2026,Coffee,-4.50'
      const result = parseBudgetTransactionsCsv(csv)
      expect(result).toEqual([])
    })

    it('drops a row with an unrecognized month name', () => {
      const csv = 'Septembr 17, 2026,Coffee,-4.50'
      const result = parseBudgetTransactionsCsv(csv)
      expect(result).toEqual([])
    })

    it('drops a row with an unparseable date string', () => {
      const csv = 'not-a-date,Coffee,-4.50'
      const result = parseBudgetTransactionsCsv(csv)
      expect(result).toEqual([])
    })

    it('parses tab-separated rows (pasted from a spreadsheet), header and all', () => {
      const csv = 'Date\tDescription\tDebit\n2026-08-17\tSOUTHWES 5262192116227800-435-9792 TX\t215.2'
      const result = parseBudgetTransactionsCsv(csv)
      expect(result).toEqual([
        { date: '2026-08-17', description: 'SOUTHWES 5262192116227800-435-9792 TX', amount: 215.2 },
      ])
    })
  })

  describe('parseOfxTransactions', () => {
    it('parses a single-account OFX fixture with 2 STMTTRN blocks', () => {
      const ofx = [
        '<OFX>',
        '<BANKMSGSRSV1>',
        '<STMTTRNRS>',
        '<STMTRS>',
        '<BANKTRANLIST>',
        '<STMTTRN>',
        '<TRNTYPE>DEBIT',
        '<DTPOSTED>20260101120000',
        '<TRNAMT>-4.50',
        '<NAME>Coffee Shop',
        '<MEMO>Latte',
        '</STMTTRN>',
        '<STMTTRN>',
        '<TRNTYPE>CREDIT',
        '<DTPOSTED>20260102120000',
        '<TRNAMT>2000.00',
        '<NAME>Paycheck',
        '<MEMO>Payroll',
        '</STMTTRN>',
        '</BANKTRANLIST>',
        '</STMTRS>',
        '</STMTTRNRS>',
        '</BANKMSGSRSV1>',
        '</OFX>',
      ].join('\n')
      const result = parseOfxTransactions(ofx)
      expect(result).toEqual([
        { date: '2026-01-01', description: 'Coffee Shop', amount: -4.5 },
        { date: '2026-01-02', description: 'Paycheck', amount: 2000 },
      ])
    })

    it('flattens STMTTRN blocks from multiple STMTRS sections (multi-account) into one array', () => {
      const ofx = [
        '<OFX>',
        '<STMTRS>',
        '<BANKTRANLIST>',
        '<STMTTRN>',
        '<DTPOSTED>20260101',
        '<TRNAMT>-10.00',
        '<NAME>Account1 Txn1',
        '</STMTTRN>',
        '<STMTTRN>',
        '<DTPOSTED>20260102',
        '<TRNAMT>-20.00',
        '<NAME>Account1 Txn2',
        '</STMTTRN>',
        '</BANKTRANLIST>',
        '</STMTRS>',
        '<STMTRS>',
        '<BANKTRANLIST>',
        '<STMTTRN>',
        '<DTPOSTED>20260201',
        '<TRNAMT>-30.00',
        '<NAME>Account2 Txn1',
        '</STMTTRN>',
        '<STMTTRN>',
        '<DTPOSTED>20260202',
        '<TRNAMT>-40.00',
        '<NAME>Account2 Txn2',
        '</STMTTRN>',
        '</BANKTRANLIST>',
        '</STMTRS>',
        '</OFX>',
      ].join('\n')
      const result = parseOfxTransactions(ofx)
      expect(result.length).toBe(4)
      expect(result.map((r) => r.description)).toEqual([
        'Account1 Txn1', 'Account1 Txn2', 'Account2 Txn1', 'Account2 Txn2',
      ])
    })

    it('uses NAME as description when present', () => {
      const ofx = [
        '<STMTTRN>',
        '<DTPOSTED>20260101',
        '<TRNAMT>-5.00',
        '<NAME>Grocery Store',
        '<MEMO>Weekly shop',
        '</STMTTRN>',
      ].join('\n')
      const result = parseOfxTransactions(ofx)
      expect(result).toEqual([
        { date: '2026-01-01', description: 'Grocery Store', amount: -5 },
      ])
    })

    it('falls back to MEMO when NAME is blank/whitespace-only', () => {
      const ofx = [
        '<STMTTRN>',
        '<DTPOSTED>20260101',
        '<TRNAMT>-5.00',
        '<NAME>   ',
        '<MEMO>Fallback Memo Text',
        '</STMTTRN>',
      ].join('\n')
      const result = parseOfxTransactions(ofx)
      expect(result).toEqual([
        { date: '2026-01-01', description: 'Fallback Memo Text', amount: -5 },
      ])
    })

    it('skips a block when both NAME and MEMO are missing/blank', () => {
      const ofx = [
        '<STMTTRN>',
        '<DTPOSTED>20260101',
        '<TRNAMT>-5.00',
        '<NAME>   ',
        '<MEMO>',
        '</STMTTRN>',
        '<STMTTRN>',
        '<DTPOSTED>20260103',
        '<TRNAMT>-7.00',
        '<NAME>Valid Row',
        '</STMTTRN>',
      ].join('\n')
      const result = parseOfxTransactions(ofx)
      expect(result).toEqual([
        { date: '2026-01-03', description: 'Valid Row', amount: -7 },
      ])
    })

    it('parses DTPOSTED with trailing time/timezone suffix', () => {
      const ofx = [
        '<STMTTRN>',
        '<DTPOSTED>20240115120000[-5:EST]',
        '<TRNAMT>-1.00',
        '<NAME>Timezone Txn',
        '</STMTTRN>',
      ].join('\n')
      const result = parseOfxTransactions(ofx)
      expect(result).toEqual([
        { date: '2024-01-15', description: 'Timezone Txn', amount: -1 },
      ])
    })

    it('parses a 6-char YYMMDD DTPOSTED, prepending 20 to the year', () => {
      const ofx = [
        '<STMTTRN>',
        '<DTPOSTED>240115',
        '<TRNAMT>-1.00',
        '<NAME>Short Date Txn',
        '</STMTTRN>',
      ].join('\n')
      const result = parseOfxTransactions(ofx)
      expect(result).toEqual([
        { date: '2024-01-15', description: 'Short Date Txn', amount: -1 },
      ])
    })

    it('skips a block whose DTPOSTED is shorter than 6 chars, keeping other valid blocks', () => {
      const ofx = [
        '<STMTTRN>',
        '<DTPOSTED>2401',
        '<TRNAMT>-1.00',
        '<NAME>Too Short Date',
        '</STMTTRN>',
        '<STMTTRN>',
        '<DTPOSTED>20260103',
        '<TRNAMT>-9.00',
        '<NAME>Valid Row',
        '</STMTTRN>',
      ].join('\n')
      const result = parseOfxTransactions(ofx)
      expect(result).toEqual([
        { date: '2026-01-03', description: 'Valid Row', amount: -9 },
      ])
    })

    it('preserves negative and positive TRNAMT signs without flipping', () => {
      const ofx = [
        '<STMTTRN>',
        '<DTPOSTED>20260101',
        '<TRNAMT>-42.75',
        '<NAME>Negative Txn',
        '</STMTTRN>',
        '<STMTTRN>',
        '<DTPOSTED>20260102',
        '<TRNAMT>42.75',
        '<NAME>Positive Txn',
        '</STMTTRN>',
      ].join('\n')
      const result = parseOfxTransactions(ofx)
      expect(result).toEqual([
        { date: '2026-01-01', description: 'Negative Txn', amount: -42.75 },
        { date: '2026-01-02', description: 'Positive Txn', amount: 42.75 },
      ])
    })

    it('returns [] for input with zero STMTTRN blocks', () => {
      const ofx = '<OFX><STMTRS><BANKTRANLIST></BANKTRANLIST></STMTRS></OFX>'
      expect(parseOfxTransactions(ofx)).toEqual([])
    })

    it('returns [] and does not throw on malformed/truncated OFX text', () => {
      const malformed = '<OFX><STMTRS><BANKTRANLIST><STMTTRN><DTPOSTED>2026<TRNAMT>garbage no closing tag'
      expect(() => parseOfxTransactions(malformed)).not.toThrow()
      expect(parseOfxTransactions(malformed)).toEqual([])
      expect(parseOfxTransactions('')).toEqual([])
      expect(parseOfxTransactions('not even xml at all, just random text')).toEqual([])
    })
  })
})
