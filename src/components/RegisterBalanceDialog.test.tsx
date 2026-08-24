import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { RegisterPage } from './RegisterPage'
import { initialState, type AppState } from '../lib/state'
import { appReducer } from '../lib/reducer'
import { normalizeDateInput } from '../lib/register'
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

function todayLocal(): string {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

/** Simulate pasting text into a drop zone, mirroring ImportDialog.test.tsx's pasteInto helper. */
function pasteInto(zone: HTMLElement, text: string) {
  const event = new Event('paste', { bubbles: true }) as any
  event.clipboardData = {
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  }
  event.preventDefault = vi.fn()
  fireEvent(zone, event)
}

function openDialog(state: AppState, dispatch: (action: any) => void = vi.fn()) {
  const utils = render(<RegisterPage state={state} dispatch={dispatch} />)
  fireEvent.click(screen.getByText('Record Balances'))
  return utils
}

describe('RegisterBalanceDialog', () => {
  it('opening the dialog shows one prefilled draft row with today\'s date and the current regAccountId scope', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', name: 'Account One', taxCategory: 'taxable' }))
    state.regAccountId = 'acc-1'

    openDialog(state)

    const dateInput = screen.getByDisplayValue(todayLocal()) as HTMLInputElement
    expect(dateInput).toBeTruthy()
    const row = dateInput.closest('tr')!
    // First select in the row is the account select
    const selects = within(row).getAllByRole('combobox')
    expect((selects[0] as HTMLSelectElement).value).toBe('acc-1')
  })

  it('manual mode: filling a valid row enables Save and dispatches ADD_BALANCE_ENTRIES with correctly-typed entry', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', name: 'Account One', taxCategory: 'taxable' }))

    const dispatch = vi.fn()
    openDialog(state, dispatch)

    const dateInput = screen.getByDisplayValue(todayLocal()) as HTMLInputElement
    const row = dateInput.closest('tr')!
    const [accountSelect] = within(row).getAllByRole('combobox')
    fireEvent.change(accountSelect, { target: { value: 'acc-1' } })

    const balanceInput = within(row).getByPlaceholderText('e.g. 12500.00')
    fireEvent.change(balanceInput, { target: { value: '1500.50' } })

    const saveBtn = screen.getByText('Save 1 entry')
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(saveBtn)

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_BALANCE_ENTRIES',
        entries: [
          expect.objectContaining({
            accountId: 'acc-1',
            date: todayLocal(),
            balance: 1500.5,
            activityType: 'None',
            activityAmount: 0,
          }),
        ],
      })
    )
  })

  it('manual mode + integration: recording an entry for an existing (accountId, date) pair results in 1 row not 2 in the activity table', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', name: 'Account One', taxCategory: 'taxable' }))
    state.balanceEntries.push(makeBalanceEntry({ id: 'b1', accountId: 'acc-1', date: '2024-01-01', balance: 1000 }))

    let currentState = state
    const dispatch = (action: any) => {
      currentState = appReducer(currentState, action)
      rerender(<RegisterPage state={currentState} dispatch={dispatch} />)
    }

    const { rerender } = render(<RegisterPage state={currentState} dispatch={dispatch} />)
    fireEvent.click(screen.getByText('Record Balances'))

    const dateInput = screen.getByDisplayValue(todayLocal()) as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2024-01-01' } })
    const row = dateInput.closest('tr')!
    const [accountSelect] = within(row).getAllByRole('combobox')
    fireEvent.change(accountSelect, { target: { value: 'acc-1' } })
    const balanceInput = within(row).getByPlaceholderText('e.g. 12500.00')
    fireEvent.change(balanceInput, { target: { value: '2000' } })

    fireEvent.click(screen.getByText('Save 1 entry'))

    expect(currentState.balanceEntries.filter((e) => e.accountId === 'acc-1' && e.date === '2024-01-01')).toHaveLength(1)
    const table = screen.getByRole('table')
    const rowsInTable = within(table).getAllByRole('row').filter((r) => within(r).queryAllByRole('cell').length > 0)
    expect(rowsInTable).toHaveLength(1)
  })

  it('paste mode: pasting header + one data row populates one correctly-mapped draft row', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', name: 'My Brokerage', institution: 'Fidelity', taxCategory: 'taxable' }))

    openDialog(state)
    fireEvent.click(screen.getByText('Copy-Paste'))

    const headersZone = screen.getByTestId('bal-paste-headers-zone')
    const valuesZone = screen.getByTestId('bal-paste-values-zone')

    pasteInto(headersZone, 'Date\tAccount\tBalance\tActivity\tAmount\tNote')
    pasteInto(valuesZone, '2024-03-01\tMy Brokerage\t5000\tContribution\t100\tmonthly')

    // normalizeDateInput (used by the dialog to normalize pasted date cells) can shift
    // a UTC-midnight-parsed date by a day depending on the host's local timezone offset —
    // compute the expected value the same way rather than hardcoding '2024-03-01'.
    const expectedDate = normalizeDateInput('2024-03-01')
    const dateInput = screen.getByDisplayValue(expectedDate) as HTMLInputElement
    const row = dateInput.closest('tr')!
    const [accountSelect] = within(row).getAllByRole('combobox')
    expect((accountSelect as HTMLSelectElement).value).toBe('acc-1')
    expect(within(row).getByDisplayValue('5000')).toBeTruthy()
    expect(within(row).getByDisplayValue('100')).toBeTruthy()
    expect(within(row).getByDisplayValue('monthly')).toBeTruthy()
  })

  it('paste mode: missing header or values text shows the error message and keeps Save disabled', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', taxCategory: 'taxable' }))

    openDialog(state)
    fireEvent.click(screen.getByText('Copy-Paste'))

    const headersZone = screen.getByTestId('bal-paste-headers-zone')
    pasteInto(headersZone, 'Date\tAccount\tBalance')
    // No values pasted

    expect(screen.getByText('Paste both a header row and at least one data row.')).toBeTruthy()
    const saveBtn = screen.getByText(/Save 0 entries/)
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('cancel closes the dialog without dispatching ADD_BALANCE_ENTRIES', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', taxCategory: 'taxable' }))

    const dispatch = vi.fn()
    openDialog(state, dispatch)

    expect(screen.getByText('Cancel')).toBeTruthy()

    fireEvent.click(screen.getByText('Cancel'))

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BALANCE_ENTRIES' }))
    expect(screen.queryByText('Cancel')).toBeNull()
  })
})
