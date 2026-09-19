import { describe, expect, it } from 'vitest'
import { appReducer } from './reducer'
import { initialState } from './state'

describe('budget reducer', () => {
  it('ensures an expense snapshot without any manual-income action', () => {
    const state = { ...initialState(), budgetExpenseAmountsByYear: { '2024': { rent: 1000 } } }
    expect(appReducer(state, { type: 'ENSURE_BUDGET_YEAR_SNAPSHOT', year: '2025' }).budgetExpenseAmountsByYear['2025']).toEqual({ rent: 1000 })
  })
})
