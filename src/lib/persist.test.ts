import { describe, expect, it } from 'vitest'
import { coalesceWithDefaults, dropLegacyBudgetIncome } from './persist'

describe('budget persistence migration', () => {
  it('drops every retired manual-income shape without creating records', () => {
    const raw = dropLegacyBudgetIncome({ budgetIncomeByYear: { '2025': { monthly: 10 } }, budgetIncomeMonthly: 10, budgetIncomeYearly: 120, budgetTransactions: [] })
    expect(raw).not.toHaveProperty('budgetIncomeByYear')
    expect(raw).not.toHaveProperty('budgetIncomeMonthly')
    expect(raw).not.toHaveProperty('budgetIncomeYearly')
    expect(coalesceWithDefaults(raw)).not.toHaveProperty('budgetIncomeByYear')
  })

  it('defaults missing budget account convention markers from old blobs', () => {
    expect(coalesceWithDefaults({ budgetTransactions: [] }).budgetAccountAppliedConventions).toEqual({})
  })

  it('defaults missing category mappings while preserving an existing empty collection', () => {
    expect(coalesceWithDefaults({}).categoryMappings).toEqual([])
    expect(coalesceWithDefaults({ categoryMappings: [] }).categoryMappings).toEqual([])
  })

})
