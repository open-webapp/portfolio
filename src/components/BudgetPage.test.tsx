import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BudgetPage } from './BudgetPage'
import { initialState } from '../lib/state'

describe('BudgetPage derived income', () => {
  it('renders five read-only cards from Income definitions and transactions', () => {
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: [
        { id: 'salary', name: 'Salary', categoryId: 'income', frequency: 'monthly' as const },
        { id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'monthly' as const },
      ],
      budgetExpenseAmountsByYear: { [String(new Date().getFullYear())]: { salary: 1000, rent: 500 } },
      budgetTransactions: [
        { id: 'pay', date: `${new Date().getFullYear()}-01-01`, description: 'Pay', categoryId: 'income', amount: 1000 },
        { id: 'rent', date: `${new Date().getFullYear()}-01-02`, description: 'Rent', categoryId: 'housing', amount: 500 },
      ],
    }
    render(<BudgetPage state={state} dispatch={vi.fn()} categories={[{ id: 'income', name: 'Income', updatedAt: '' }, { id: 'housing', name: 'Housing', updatedAt: '' }]} categoryMappings={[]} categoryDispatch={vi.fn()} />)
    expect(screen.getByText('Budgeted income')).toBeTruthy()
    expect(screen.getByText(`Actual income (${new Date().getFullYear()})`)).toBeTruthy()
    expect(screen.getAllByText('$12,000.00')).toHaveLength(1)
    expect(screen.queryByLabelText('Edit income')).toBeNull()
  })
})
