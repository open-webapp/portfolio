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

  it('ignores stray categoryMappings key without crashing', () => {
    const coalesced = coalesceWithDefaults({ categoryMappings: [{ id: 'x' }] } as unknown as Parameters<typeof coalesceWithDefaults>[0])
    expect(coalesced).not.toHaveProperty('categoryMappings')
    const roundTripped = coalesceWithDefaults(JSON.parse(JSON.stringify(coalesced)))
    expect(roundTripped).not.toHaveProperty('categoryMappings')
  })

  it('loads tags-only records with autoTags absent and tags intact (no guessing)', () => {
    const coalesced = coalesceWithDefaults({
      budgetTransactions: [
        { id: 't1', date: '2025-01-01', description: 'Store', categoryId: 'c1', amount: 10, tags: ['groceries'] },
        { id: 't2', date: '2025-01-02', description: 'Cafe', categoryId: 'c1', amount: 5 },
      ],
    })
    expect(coalesced.budgetTransactions).toHaveLength(2)
    expect(coalesced.budgetTransactions[0].tags).toEqual(['groceries'])
    expect(coalesced.budgetTransactions[0]).not.toHaveProperty('autoTags')
    expect(coalesced.budgetTransactions[1].tags).toBeUndefined()
    expect(coalesced.budgetTransactions[1].autoTags).toBeUndefined()
  })

  it('preserves an existing tags/autoTags split through coalesce', () => {
    const coalesced = coalesceWithDefaults({
      budgetTransactions: [
        { id: 't1', date: '2025-01-01', description: 'Store', categoryId: 'c1', amount: 10, tags: ['user-tag'], autoTags: ['auto-tag'] },
      ],
    })
    expect(coalesced.budgetTransactions[0].tags).toEqual(['user-tag'])
    expect(coalesced.budgetTransactions[0].autoTags).toEqual(['auto-tag'])
  })

})
