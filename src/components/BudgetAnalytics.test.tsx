import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BudgetAnalytics } from './BudgetAnalytics'
import { initialState } from '../lib/state'

describe('BudgetAnalytics derived income', () => {
  it('does not render spend analytics for Income-only records', () => {
    const year = String(new Date().getFullYear())
    render(<BudgetAnalytics state={{ ...initialState(), budgetTransactions: [{ id: 'pay', date: `${year}-01-01`, description: 'Pay', categoryId: 'income', amount: 1000 }] }} categories={[{ id: 'income', name: 'Income', updatedAt: '' }]} />)
    expect(screen.getAllByText('No records for this period.')).toHaveLength(7)
  })
})
