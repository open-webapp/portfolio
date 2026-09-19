import { describe, expect, it } from 'vitest'
import { parseExpensePaste } from './expensePasteImport'

describe('parseExpensePaste', () => {
  it('skips the first nonblank header and blank lines while preserving physical line numbers', () => {
    expect(parseExpensePaste('\n  Name, Amount\n\nCoffee, 4.50\n   \nLunch, 12\n')).toEqual({
      totalDataLines: 2,
      validRows: [
        { name: 'Coffee', amount: 4.5, lineNumber: 4 },
        { name: 'Lunch', amount: 12, lineNumber: 6 },
      ],
      errors: [],
    })
  })

  it('parses comma and tab rows, dollar amounts, and tab thousands groups', () => {
    expect(parseExpensePaste('Name\tAmount\nCoffee, $12.50\nRent\t1,234.50')).toEqual({
      totalDataLines: 2,
      validRows: [
        { name: 'Coffee', amount: 12.5, lineNumber: 2 },
        { name: 'Rent', amount: 1234.5, lineNumber: 3 },
      ],
      errors: [],
    })
  })

  it('returns every invalid data line with its physical line number', () => {
    const result = parseExpensePaste([
      'Name\tAmount',
      'Comma thousands,1,234.50',
      'Bad grouping\t12,34.50',
      'Zero,0',
      'Negative,-1',
      'NaN,NaN',
      ',10',
      'Missing amount',
      'Extra,10,20',
    ].join('\n'))

    expect(result.totalDataLines).toBe(8)
    expect(result.validRows).toEqual([])
    expect(result.errors).toEqual([
      { lineNumber: 2, reason: 'expected exactly two fields' },
      { lineNumber: 3, reason: 'amount must be a positive decimal number' },
      { lineNumber: 4, reason: 'amount must be greater than zero' },
      { lineNumber: 5, reason: 'amount must be a positive decimal number' },
      { lineNumber: 6, reason: 'amount must be a positive decimal number' },
      { lineNumber: 7, reason: 'name is required' },
      { lineNumber: 8, reason: 'expected exactly two fields' },
      { lineNumber: 9, reason: 'expected exactly two fields' },
    ])
  })

  it('handles empty and header-only pastes', () => {
    expect(parseExpensePaste(' \n\t\n')).toEqual({ totalDataLines: 0, validRows: [], errors: [] })
    expect(parseExpensePaste('\nName,Amount\n\n')).toEqual({ totalDataLines: 0, validRows: [], errors: [] })
  })
})
