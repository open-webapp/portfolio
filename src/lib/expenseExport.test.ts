import { describe, expect, it } from 'vitest'
import { buildExpenseCsv } from './expenseExport'
import type { BudgetTransaction, Category, ExpenseDefinition } from './types'

const now = new Date(2026, 5, 1)

describe('buildExpenseCsv', () => {
  it('serializes every definition in category then name order with display frequencies and raw yearly amounts', () => {
    const definitions: ExpenseDefinition[] = [
      { id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'monthly' },
      { id: 'insurance', name: 'Insurance', categoryId: 'bills', frequency: 'yearly' },
      { id: 'internet', name: 'Internet', categoryId: 'bills', frequency: 'monthly' }
    ]
    const categories: Category[] = [
      { id: 'housing', name: 'Housing', updatedAt: '' },
      { id: 'bills', name: 'Bills', updatedAt: '' }
    ]
    const transactions: BudgetTransaction[] = [
      { id: 't1', date: '2024-01-15', description: 'ignored', categoryId: 'bills', amount: 10 }
    ]

    expect(buildExpenseCsv(definitions, {
      '2023': { rent: 1200, insurance: 500, internet: 60 },
      '2024': { rent: 1250, insurance: 550, internet: 65 }
    }, transactions, categories, now)).toBe(
      'Name,Category,Frequency,2023,2024,2026\r\n' +
      'Insurance,Bills,Yearly,500,550,\r\n' +
      'Internet,Bills,Monthly,60,65,\r\n' +
      'Rent,Housing,Monthly,1200,1250,\r\n'
    )
  })

  it('returns only a header when no definitions exist', () => {
    expect(buildExpenseCsv([], {}, [], [], now)).toBe('Name,Category,Frequency,2026\r\n')
  })

  it('uses every year source and RFC4180-escapes Unicode text while leaving unset amounts blank', () => {
    const definitions: ExpenseDefinition[] = [
      { id: 'first', name: 'Café, "Late"\nFees', categoryId: 'missing', frequency: 'monthly' },
      { id: 'second', name: 'Annual', categoryId: 'cat', frequency: 'yearly' }
    ]
    const categories: Category[] = [{ id: 'cat', name: 'Utilities', updatedAt: '' }]
    const transactions: BudgetTransaction[] = [
      { id: 't1', date: '2022-12-31', description: 'not exported', categoryId: 'cat', amount: 4 }
    ]

    expect(buildExpenseCsv(definitions, {
      '2024': { first: 10 },
      '2025': { second: 20 }
    }, transactions, categories, now)).toBe(
      'Name,Category,Frequency,2022,2024,2025,2026\r\n' +
      '"Café, ""Late""\nFees",missing,Monthly,,10,,\r\n' +
      'Annual,Utilities,Yearly,,,20,\r\n'
    )
  })

  it('prefixes formula-leading text but preserves negative numeric amounts and excludes actual spend fields', () => {
    const definitions: ExpenseDefinition[] = [
      { id: 'formula', name: '=SUM(A1:A2)', categoryId: '+category', frequency: 'monthly' },
      { id: 'at', name: '@handle', categoryId: '-category', frequency: 'yearly' }
    ]
    const transactions: BudgetTransaction[] = [
      {
        id: 'secret',
        date: '2025-02-03',
        description: 'Actual Spend must not appear',
        categoryId: 'other',
        accountName: 'Private Account',
        amount: 9999
      }
    ]

    const csv = buildExpenseCsv(definitions, { '2025': { formula: -42, at: 7 } }, transactions, [], now)

    expect(csv).toBe(
      "Name,Category,Frequency,2025,2026\r\n" +
      "'@handle,'-category,Yearly,7,\r\n" +
      "'=SUM(A1:A2),'+category,Monthly,-42,\r\n"
    )
    expect(csv).not.toContain('Actual Spend')
    expect(csv).not.toContain('Private Account')
    expect(csv).not.toContain('9999')
  })
})
