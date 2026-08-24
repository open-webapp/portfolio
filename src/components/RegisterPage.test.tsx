import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { RegisterPage } from './RegisterPage'
import { initialState, type AppState } from '../lib/state'
import type { Account, BalanceEntry } from '../lib/types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id ?? `acc-${Math.random()}`,
    accountNumber: overrides.accountNumber ?? '1234',
    name: overrides.name ?? 'Brokerage',
    institution: overrides.institution ?? 'Fidelity',
    taxCategory: overrides.taxCategory ?? 'taxable',
    retirement: overrides.retirement ?? false,
    createdAt: overrides.createdAt ?? '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeBalanceEntry(overrides: Partial<BalanceEntry> = {}): BalanceEntry {
  return {
    id: overrides.id ?? `bal-${Math.random()}`,
    accountId: overrides.accountId ?? 'acc-1',
    date: overrides.date ?? '2024-01-01',
    balance: overrides.balance ?? 1000,
    activityType: overrides.activityType ?? 'None',
    activityAmount: overrides.activityAmount ?? 0,
    note: overrides.note ?? '',
    ...overrides,
  }
}

describe('RegisterPage', () => {
  it('renders "All Accounts" plus one card per tax category present in state accounts', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(
      makeAccount({ id: 'acc-1', taxCategory: 'taxable' }),
      makeAccount({ id: 'acc-2', taxCategory: 'taxDeferred' }),
    )

    render(<RegisterPage state={state} dispatch={vi.fn()} />)

    expect(screen.getByText('All Accounts')).toBeTruthy()
    // registerCategoryCards returns one card per known TaxCategory regardless of membership
    expect(screen.getAllByText(/Taxable|Tax-Deferred|Tax Deferred|Non-Taxable/i).length).toBeGreaterThan(0)
  })

  it('clicking a category card expands it and shows its accounts', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', name: 'My Brokerage', institution: 'Fidelity', taxCategory: 'taxable' }))

    const dispatch = vi.fn()
    const { rerender } = render(<RegisterPage state={state} dispatch={dispatch} />)

    expect(screen.queryByText((_, el) => !!el && el.tagName === 'DIV' && el.textContent === 'Fidelity — My Brokerage')).toBeNull()

    const categoryLabel = screen.getAllByText(/^taxable$/i)[0]
    expect(categoryLabel).toBeTruthy()
    // The label span's grandparent is the clickable card-header div (onClick handler)
    fireEvent.click(categoryLabel.parentElement!.parentElement!)
    expect(dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_REG_CATEGORY_EXPANDED', categoryKey: 'taxable' })

    const expandedState: AppState = { ...state, regExpanded: { ...state.regExpanded, taxable: true } }
    rerender(<RegisterPage state={expandedState} dispatch={dispatch} />)
    expect(
      screen.getByText((_, el) => !!el && el.tagName === 'DIV' && el.textContent === 'Fidelity — My Brokerage')
    ).toBeTruthy()
  })

  it('selecting an account filters the stats strip to that account only', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(
      makeAccount({ id: 'acc-1', name: 'Account One', taxCategory: 'taxable' }),
      makeAccount({ id: 'acc-2', name: 'Account Two', taxCategory: 'taxable' }),
    )
    state.balanceEntries.push(
      makeBalanceEntry({ id: 'b1', accountId: 'acc-1', date: '2024-01-01', balance: 1000 }),
      makeBalanceEntry({ id: 'b2', accountId: 'acc-1', date: '2024-02-01', balance: 1200 }),
      makeBalanceEntry({ id: 'b3', accountId: 'acc-2', date: '2024-01-01', balance: 5000 }),
      makeBalanceEntry({ id: 'b4', accountId: 'acc-2', date: '2024-02-01', balance: 5500 }),
    )

    function currentBalanceText(): string | null {
      const label = screen.getByText('Current balance')
      const valueEl = label.parentElement!.querySelector('div:nth-child(2)')
      return valueEl ? valueEl.textContent : null
    }

    // Combined: current balance 1200+5500=6700
    const { rerender } = render(<RegisterPage state={state} dispatch={vi.fn()} />)
    expect(currentBalanceText()).toBe('$6,700.00')

    // Now scope to acc-1 only: current balance should be 1200
    const scopedState: AppState = { ...state, regAccountId: 'acc-1' }
    rerender(<RegisterPage state={scopedState} dispatch={vi.fn()} />)
    expect(currentBalanceText()).toBe('$1,200.00')
  })

  it('activity filter toggle to "With Activity" hides rows where activityType is None', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', name: 'Account One', taxCategory: 'taxable' }))
    state.balanceEntries.push(
      makeBalanceEntry({ id: 'b1', accountId: 'acc-1', date: '2024-01-01', balance: 1000, activityType: 'None' }),
      makeBalanceEntry({
        id: 'b2',
        accountId: 'acc-1',
        date: '2024-02-01',
        balance: 1200,
        activityType: 'Contribution',
        activityAmount: 200,
      }),
    )

    const dispatch = vi.fn()
    const { rerender } = render(<RegisterPage state={state} dispatch={dispatch} />)
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(3) // header + 2 rows

    const withActivityLabel = screen.getByText('With Activity')
    fireEvent.click(withActivityLabel)
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_REG_ACTIVITY_FILTER', filter: 'With Activity' })

    const filteredState: AppState = { ...state, regActivityFilter: 'With Activity' }
    rerender(<RegisterPage state={filteredState} dispatch={dispatch} />)
    const filteredTable = screen.getByRole('table')
    expect(within(filteredTable).getAllByRole('row')).toHaveLength(2) // header + 1 row (contribution)
  })

  it('deletes a balance entry when confirmed, and does not dispatch when confirm is cancelled', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', name: 'Account One', taxCategory: 'taxable' }))
    state.balanceEntries.push(makeBalanceEntry({ id: 'b1', accountId: 'acc-1', date: '2024-01-01', balance: 1000 }))

    const dispatch = vi.fn()
    render(<RegisterPage state={state} dispatch={dispatch} />)

    const confirmSpy = vi.spyOn(window, 'confirm')

    confirmSpy.mockReturnValueOnce(false)
    fireEvent.click(screen.getByTitle('Delete entry'))
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DELETE_BALANCE_ENTRY' }))

    confirmSpy.mockReturnValueOnce(true)
    fireEvent.click(screen.getByTitle('Delete entry'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_BALANCE_ENTRY', id: 'b1' })
  })

  it('shows the empty state when there are no balance entries for the current scope', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', name: 'Account One', taxCategory: 'taxable' }))

    render(<RegisterPage state={state} dispatch={vi.fn()} />)

    expect(screen.getByText('No balance entries recorded for this scope yet.')).toBeTruthy()
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(1) // header row only, no data rows
  })
})
