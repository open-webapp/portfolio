import { describe, it, expect } from 'vitest'
import { applyFieldMap, validatePreviewRow, isReviewValid } from './importPreview'

const positionsRow = {
  Symbol: 'AAPL',
  Name: 'Apple Inc.',
  Class: 'Equity',
  Qty: '100',
  Cost: '150.25',
  Price: '180.50',
}

const positionsFieldMap = {
  Symbol: 'symbol',
  Class: 'assetClass',
  Qty: 'shares',
  Cost: 'avgCost',
  Price: 'price',
}

const completePositionsValues = {
  symbol: 'AAPL',
  assetClass: 'Equity',
  shares: '100',
  avgCost: '150.25',
  price: '180.50',
}

const completeTransactionsValues = {
  date: '2026-08-08',
  symbol: 'AAPL',
  type: 'BUY',
  shares: '100',
  price: '180.50',
  amount: '18050.00',
}

const completeTransactionsFieldMap = {
  TransDate: 'date',
  Ticker: 'symbol',
  TxType: 'type',
  Qty: 'shares',
  Price: 'price',
  Amount: 'amount',
}

const withoutKey = (obj: Record<string, string>, key: string): Record<string, string> => {
  const copy = { ...obj }
  delete copy[key]
  return copy
}

describe('applyFieldMap', () => {
  it('renames CSV headers to internal field names per fieldMap and drops unmapped columns', () => {
    const mapped = applyFieldMap(positionsRow, positionsFieldMap)

    expect(mapped.symbol).toBe('AAPL')
    expect(mapped.assetClass).toBe('Equity')
    expect(mapped.shares).toBe('100')
    expect(mapped.avgCost).toBe('150.25')
    expect(mapped.price).toBe('180.50')
    expect(mapped.Name).toBeUndefined()
    expect(mapped.Symbol).toBeUndefined()
  })

  it('result key order follows fieldMap iteration order', () => {
    const mapped = applyFieldMap(positionsRow, positionsFieldMap)

    expect(Object.keys(mapped)).toEqual(['symbol', 'assetClass', 'shares', 'avgCost', 'price'])
  })

  it('with an empty fieldMap returns an empty object regardless of input row', () => {
    expect(applyFieldMap(positionsRow, {})).toEqual({})
  })
})

describe('validatePreviewRow (positions)', () => {
  it('is valid when all required fields are present', () => {
    const result = validatePreviewRow('positions', completePositionsValues)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('is valid when every field is empty (blank row should not block import)', () => {
    const result = validatePreviewRow('positions', {
      symbol: '',
      assetClass: '',
      shares: '',
      avgCost: '',
      price: '',
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('errors when symbol is missing', () => {
    const result = validatePreviewRow('positions', { ...completePositionsValues, symbol: '' })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing symbol')
  })

  it('errors when assetClass is missing', () => {
    const result = validatePreviewRow('positions', { ...completePositionsValues, assetClass: '' })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing asset class')
  })

  it('errors when shares is missing', () => {
    const result = validatePreviewRow('positions', { ...completePositionsValues, shares: '' })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing shares')
  })

  it('errors when both avgCost and purchaseAmount are missing', () => {
    const result = validatePreviewRow('positions', {
      ...completePositionsValues,
      avgCost: '',
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing cost basis (avgCost or purchaseAmount)')
  })

  it('is valid when purchaseAmount is present without avgCost', () => {
    const result = validatePreviewRow('positions', {
      ...withoutKey(completePositionsValues, 'avgCost'),
      purchaseAmount: '15025.00',
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('errors when both price and marketValue are missing', () => {
    const result = validatePreviewRow('positions', {
      ...completePositionsValues,
      price: '',
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing price (price or marketValue)')
  })

  it('is valid when marketValue is present without price', () => {
    const result = validatePreviewRow('positions', {
      ...withoutKey(completePositionsValues, 'price'),
      marketValue: '18050.00',
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})

describe('validatePreviewRow (transactions)', () => {
  it('is valid when all six required fields are present', () => {
    const result = validatePreviewRow('transactions', completeTransactionsValues)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('is valid when every field is empty (blank row should not block import)', () => {
    const result = validatePreviewRow('transactions', {
      date: '',
      symbol: '',
      type: '',
      shares: '',
      price: '',
      amount: '',
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('errors when any required field is missing', () => {
    const cases: Array<[string, string]> = [
      ['date', 'Missing date'],
      ['symbol', 'Missing symbol'],
      ['type', 'Missing type'],
      ['shares', 'Missing shares'],
      ['price', 'Missing price'],
      ['amount', 'Missing amount'],
    ]

    for (const [field, error] of cases) {
      const result = validatePreviewRow('transactions', { ...completeTransactionsValues, [field]: '' })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain(error)
    }
  })
})

describe('isReviewValid (positions)', () => {
  it('is true when fieldMap maps all always-required fields plus one of each alternative pair', () => {
    expect(isReviewValid('positions', positionsFieldMap)).toBe(true)
  })

  it('is false when symbol is not a mapped target', () => {
    expect(isReviewValid('positions', withoutKey(positionsFieldMap, 'Symbol'))).toBe(false)
  })

  it('is true when assetClass is not a mapped target (assetClass is no longer required in fieldMap)', () => {
    expect(isReviewValid('positions', withoutKey(positionsFieldMap, 'Class'))).toBe(true)
  })

  it('is false when shares is not a mapped target', () => {
    expect(isReviewValid('positions', withoutKey(positionsFieldMap, 'Qty'))).toBe(false)
  })

  it('is false when neither avgCost nor purchaseAmount is mapped', () => {
    expect(isReviewValid('positions', withoutKey(positionsFieldMap, 'Cost'))).toBe(false)
  })

  it('is true via purchaseAmount when avgCost is missing', () => {
    expect(
      isReviewValid('positions', { ...withoutKey(positionsFieldMap, 'Cost'), Amount: 'purchaseAmount' })
    ).toBe(true)
  })

  it('is false when neither price nor marketValue is mapped', () => {
    expect(isReviewValid('positions', withoutKey(positionsFieldMap, 'Price'))).toBe(false)
  })

  it('is true via marketValue when price is missing', () => {
    expect(
      isReviewValid('positions', { ...withoutKey(positionsFieldMap, 'Price'), MarketVal: 'marketValue' })
    ).toBe(true)
  })
})

describe('isReviewValid (transactions)', () => {
  it('is true when all six required fields are mapped targets', () => {
    expect(isReviewValid('transactions', completeTransactionsFieldMap)).toBe(true)
  })

  it('is false when any required field is not a mapped target', () => {
    const cases: Array<[string, string]> = [
      ['TransDate', 'date'],
      ['Ticker', 'symbol'],
      ['TxType', 'type'],
      ['Qty', 'shares'],
      ['Price', 'price'],
      ['Amount', 'amount'],
    ]

    for (const [key, field] of cases) {
      const rest = withoutKey(completeTransactionsFieldMap, key)

      expect(isReviewValid('transactions', rest)).toBe(false)
      expect(rest).not.toHaveProperty(field)
    }
  })
})
