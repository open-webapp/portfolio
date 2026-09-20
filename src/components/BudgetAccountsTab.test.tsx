import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BudgetAccountsTab } from './BudgetAccountsTab'
import type { BudgetAccountRule, BudgetTransaction } from '../lib/types'

afterEach(() => cleanup())

const rule: BudgetAccountRule = {
  normalizedName: 'primary checking',
  displayName: 'Primary Checking',
  statementConvention: 'positiveSpend',
  updatedAt: '',
}

function renderTab(transactions: BudgetTransaction[] = [], rules: BudgetAccountRule[] = [rule]) {
  const dispatch = vi.fn()
  const onReconcile = vi.fn()
  const view = render(
    <BudgetAccountsTab
      transactions={transactions}
      budgetAccountRules={rules}
      hydrated
      dispatch={dispatch}
      onReconcile={onReconcile}
    />,
  )
  return { ...view, dispatch, onReconcile }
}

describe('BudgetAccountsTab', () => {
  it('lists the canonical configured-and-observed union with local counts and default convention', () => {
    renderTab([
      { id: 'one', date: '2026-01-01', description: 'Store', categoryId: 'other', amount: -10, accountName: ' primary checking ' },
      { id: 'two', date: '2026-01-02', description: 'Store', categoryId: 'other', amount: -20, accountName: 'Cash' },
      { id: 'three', date: '2026-01-03', description: 'Store', categoryId: 'other', amount: -30 },
    ])

    expect(screen.getByText('Primary Checking')).toBeTruthy()
    expect(screen.getByText('Cash')).toBeTruthy()
    expect(screen.getAllByText('1 local transaction')).toHaveLength(2)
    expect(screen.getByText('Canonical amount: positive = spend')).toBeTruthy()
    expect(screen.getByText('Canonical amount: negative = spend')).toBeTruthy()
    expect(screen.queryByText('Import statement transactions to configure account sign rules.')).toBeNull()
  })

  it('confirms a real convention change, then configures and locally reconciles', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { dispatch, onReconcile } = renderTab([{ id: 'one', date: '2026-01-01', description: 'Store', categoryId: 'other', amount: -10, accountName: 'Primary Checking' }])

    fireEvent.click(within(screen.getByLabelText('Statement convention for Primary Checking')).getByText('Statement negative = spend'))

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Primary Checking'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 local transaction'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('other portfolios when they are opened'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'CONFIGURE_BUDGET_ACCOUNT_RULE', name: 'Primary Checking', convention: 'negativeSpend' })
    expect(onReconcile).toHaveBeenCalledWith([expect.objectContaining({ statementConvention: 'negativeSpend' })])
    confirm.mockRestore()
  })

  it('does not confirm or dispatch for the active convention or a cancelled change', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { dispatch, onReconcile } = renderTab()

    const convention = screen.getByLabelText('Statement convention for Primary Checking')
    fireEvent.click(within(convention).getByText('Statement positive = spend'))
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(within(convention).getByText('Statement negative = spend'))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(dispatch).not.toHaveBeenCalled()
    expect(onReconcile).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('only allows a zero-local configured rule to be removed', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { dispatch, onReconcile } = renderTab([], [rule, {
      normalizedName: 'unused', displayName: 'Unused', statementConvention: 'negativeSpend', updatedAt: '',
    }])

    expect(screen.getAllByText('Remove rule')).toHaveLength(2)
    fireEvent.click(screen.getAllByText('Remove rule')[1])
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Unused'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_BUDGET_ACCOUNT_RULE', normalizedName: 'unused' })
    expect(onReconcile).toHaveBeenCalledWith([expect.objectContaining({ normalizedName: 'primary checking' }), expect.objectContaining({ normalizedName: 'unused', deletedAt: expect.any(String) })])
    confirm.mockRestore()

    cleanup()
    renderTab([{ id: 'one', date: '2026-01-01', description: 'Store', categoryId: 'other', amount: -10, accountName: 'Primary Checking' }], [rule])
    expect(screen.queryByText('Remove rule')).toBeNull()
  })

  it('does not confirm or reconcile when Drive-origin rules rerender the tab', () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { rerender, onReconcile } = renderTab()

    rerender(<BudgetAccountsTab transactions={[]} budgetAccountRules={[{ ...rule, statementConvention: 'negativeSpend' }]} hydrated dispatch={vi.fn()} onReconcile={onReconcile} />)

    expect(confirm).not.toHaveBeenCalled()
    expect(onReconcile).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('has an import guidance empty state', () => {
    renderTab([], [])
    expect(screen.getByText('Import statement transactions to configure account sign rules.')).toBeTruthy()
  })
})
