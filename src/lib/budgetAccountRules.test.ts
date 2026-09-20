import { describe, expect, it } from 'vitest'
import type { BudgetAccountRule, BudgetTransaction, StatementConvention } from './types'
import {
  budgetAccountViewRows,
  convertBudgetAccountImportRows,
  normalizeBudgetAccountName,
  reconcileBudgetAccountRules,
} from './budgetAccountRules'

const positiveRule: BudgetAccountRule = {
  normalizedName: 'primary checking',
  displayName: 'Primary Checking',
  statementConvention: 'positiveSpend',
  updatedAt: '2026-09-19T00:00:00.000Z',
}

function transaction(overrides: Partial<BudgetTransaction> = {}): BudgetTransaction {
  return {
    id: 'transaction-1',
    date: '2026-09-19',
    description: 'Test',
    categoryId: 'category-1',
    accountName: 'Primary Checking',
    amount: 10,
    ...overrides,
  }
}

describe('budget account rules', () => {
  it('normalizes account names for canonical matching', () => {
    expect(normalizeBudgetAccountName('  Primary Checking  ')).toBe('primary checking')
    expect(normalizeBudgetAccountName(undefined)).toBe('')
  })

  it('negates positive debit and credit import rows for positive-spend accounts', () => {
    const rows = [
      { ...transaction({ type: 'Debit' }), type: 'Debit' },
      { ...transaction({ id: 'transaction-2', type: 'Credit' }), type: 'Credit' },
    ]

    expect(convertBudgetAccountImportRows(rows, [positiveRule])).toEqual([
      expect.objectContaining({ amount: -10 }),
      expect.objectContaining({ amount: -10 }),
    ])
  })

  it('uses a rule display name for mixed-case account rows', () => {
    const result = reconcileBudgetAccountRules(
      [transaction({ accountName: '  PRIMARY checking  ' })],
      [positiveRule],
      {},
    )

    expect(result.transactions[0]).toMatchObject({ accountName: 'Primary Checking', amount: -10 })
    expect(result.markers).toEqual({ 'primary checking': 'positiveSpend' })
  })

  it('unions global-only and local-only accounts with transaction counts', () => {
    const rows = budgetAccountViewRows(
      [positiveRule, { ...positiveRule, displayName: 'Savings', normalizedName: 'savings' }],
      [transaction({ accountName: 'primary checking' }), transaction({ id: 'transaction-2', accountName: 'Cash' })],
    )

    expect(rows).toEqual([
      { accountName: 'Cash', transactionCount: 1, statementConvention: 'negativeSpend' },
      { accountName: 'Primary Checking', transactionCount: 1, statementConvention: 'positiveSpend' },
      { accountName: 'Savings', transactionCount: 0, statementConvention: 'positiveSpend' },
    ])
  })

  it('does not convert default negative-spend imports', () => {
    const rows = [transaction()]
    expect(convertBudgetAccountImportRows(rows, [])).toBe(rows)
  })

  it('reverts a deleted positive-spend rule to the default convention', () => {
    const result = reconcileBudgetAccountRules(
      [transaction({ amount: -10 })],
      [{ ...positiveRule, deletedAt: '2026-09-19T00:00:00.000Z' }],
      { 'primary checking': 'positiveSpend' },
    )

    expect(result.transactions[0].amount).toBe(10)
    expect(result.markers).toEqual({ 'primary checking': 'negativeSpend' })
  })

  it('reconciles all transaction types once and preserves references on repeat', () => {
    const initial = [transaction({ type: 'Transfer', amount: 25 })]
    const first = reconcileBudgetAccountRules(initial, [positiveRule], {})
    const second = reconcileBudgetAccountRules(first.transactions, [positiveRule], first.markers)

    expect(first.transactions[0].amount).toBe(-25)
    expect(second.transactions).toBe(first.transactions)
    expect(second.markers).toBe(first.markers)
  })

  it('leaves blank names and nonfinite amounts untouched without inventing markers', () => {
    const nonfinite = transaction({ id: 'transaction-2', amount: Number.NaN })
    const rows = [transaction({ accountName: '   ' }), nonfinite]
    const result = reconcileBudgetAccountRules(rows, [positiveRule], {})

    expect(result.transactions[0]).toBe(rows[0])
    expect(result.transactions[1]).toBe(nonfinite)
    expect(result.markers).toEqual({ 'primary checking': 'positiveSpend' } satisfies Record<string, StatementConvention>)
    expect(budgetAccountViewRows([positiveRule], [rows[0]])).toEqual([
      { accountName: 'Primary Checking', transactionCount: 0, statementConvention: 'positiveSpend' },
    ])
  })
})
