import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { RegisterPage } from './RegisterPage'
import { RegisterBalanceDialog } from './RegisterBalanceDialog'
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
    activities: overrides.activities ?? [],
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
            activities: [],
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
    const table = row.closest('table')!
    expect(within(table).getByDisplayValue('100')).toBeTruthy()
    expect(within(table).getByDisplayValue('monthly')).toBeTruthy()
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

  it('manual mode: adding two activities on a row and filling them dispatches an entry with both activities', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', name: 'Account One', taxCategory: 'taxable' }))

    const dispatch = vi.fn()
    openDialog(state, dispatch)

    const dateInput = screen.getByDisplayValue(todayLocal()) as HTMLInputElement
    const row = dateInput.closest('tr')!
    const [accountSelect] = within(row).getAllByRole('combobox')
    fireEvent.change(accountSelect, { target: { value: 'acc-1' } })
    const balanceInput = within(row).getByPlaceholderText('e.g. 12500.00')
    fireEvent.change(balanceInput, { target: { value: '1000' } })

    const table = row.closest('table')!
    const addActivityBtn = within(table).getByText('+ Add activity')
    fireEvent.click(addActivityBtn)
    fireEvent.click(addActivityBtn)

    const amountInputs = within(table).getAllByPlaceholderText('0.00')
    expect(amountInputs).toHaveLength(2)
    const noteInputs = within(table).getAllByPlaceholderText('Note')
    expect(noteInputs).toHaveLength(2)
    // Combobox order in the table: account select, then one select per activity (each in its own sibling <tr>).
    const selects = within(table).getAllByRole('combobox')
    expect(selects).toHaveLength(3)

    fireEvent.change(selects[1], { target: { value: 'Contribution' } })
    fireEvent.change(amountInputs[0], { target: { value: '100' } })
    fireEvent.change(noteInputs[0], { target: { value: 'first' } })

    fireEvent.change(selects[2], { target: { value: 'Fee' } })
    fireEvent.change(amountInputs[1], { target: { value: '25' } })
    fireEvent.change(noteInputs[1], { target: { value: 'second' } })

    fireEvent.click(screen.getByText('Save 1 entry'))

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_BALANCE_ENTRIES',
        entries: [
          expect.objectContaining({
            accountId: 'acc-1',
            activities: [
              { type: 'Contribution', amount: 100, note: 'first' },
              { type: 'Fee', amount: 25, note: 'second' },
            ],
          }),
        ],
      })
    )
  })

  it('manual mode: an added activity renders as a sibling <tr> beneath the balance row, not nested inside it', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', name: 'Account One', taxCategory: 'taxable' }))

    const dispatch = vi.fn()
    openDialog(state, dispatch)

    const dateInput = screen.getByDisplayValue(todayLocal()) as HTMLInputElement
    const row = dateInput.closest('tr')!
    const table = row.closest('table')!
    const addActivityBtn = within(table).getByText('+ Add activity')
    fireEvent.click(addActivityBtn)

    expect(row.nextElementSibling).toBeTruthy()
    expect(row.nextElementSibling!.tagName).toBe('TR')
    expect(row.parentElement!.contains(row.nextElementSibling)).toBe(true)
    expect(row.querySelector('tr')).toBeNull()
  })

  it('manual mode: default single blank row table header has exactly 4 columns', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', name: 'Account One', taxCategory: 'taxable' }))

    openDialog(state)

    const dateInput = screen.getByDisplayValue(todayLocal()) as HTMLInputElement
    const table = dateInput.closest('table')!
    const headers = within(table).getAllByRole('columnheader')
    expect(headers).toHaveLength(4)
  })

  it('manual mode: two activities render as two sibling <tr>s followed by the "+ Add activity" row', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', name: 'Account One', taxCategory: 'taxable' }))

    const dispatch = vi.fn()
    openDialog(state, dispatch)

    const dateInput = screen.getByDisplayValue(todayLocal()) as HTMLInputElement
    const row = dateInput.closest('tr')!
    const table = row.closest('table')!
    const addActivityBtn = within(table).getByText('+ Add activity')
    fireEvent.click(addActivityBtn)
    fireEvent.click(addActivityBtn)

    const firstActivityRow = row.nextElementSibling as HTMLElement
    const secondActivityRow = firstActivityRow.nextElementSibling as HTMLElement
    const addRowTr = secondActivityRow.nextElementSibling as HTMLElement

    expect(firstActivityRow.tagName).toBe('TR')
    expect(secondActivityRow.tagName).toBe('TR')
    expect(addRowTr.tagName).toBe('TR')
    expect(within(addRowTr).getByText('+ Add activity')).toBeTruthy()
  })

  it('manual mode: removing one of two activities before Save leaves only the remaining activity', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', name: 'Account One', taxCategory: 'taxable' }))

    const dispatch = vi.fn()
    openDialog(state, dispatch)

    const dateInput = screen.getByDisplayValue(todayLocal()) as HTMLInputElement
    const row = dateInput.closest('tr')!
    const [accountSelect] = within(row).getAllByRole('combobox')
    fireEvent.change(accountSelect, { target: { value: 'acc-1' } })
    const balanceInput = within(row).getByPlaceholderText('e.g. 12500.00')
    fireEvent.change(balanceInput, { target: { value: '1000' } })

    const table = row.closest('table')!
    const addActivityBtn = within(table).getByText('+ Add activity')
    fireEvent.click(addActivityBtn)
    fireEvent.click(addActivityBtn)

    let amountInputs = within(table).getAllByPlaceholderText('0.00')
    fireEvent.change(amountInputs[0], { target: { value: '100' } })
    fireEvent.change(amountInputs[1], { target: { value: '25' } })

    const removeActivityBtns = within(table).getAllByTitle('Remove activity')
    expect(removeActivityBtns).toHaveLength(2)
    fireEvent.click(removeActivityBtns[0])

    amountInputs = within(table).getAllByPlaceholderText('0.00')
    expect(amountInputs).toHaveLength(1)
    expect((amountInputs[0] as HTMLInputElement).value).toBe('25')

    fireEvent.click(screen.getByText('Save 1 entry'))

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_BALANCE_ENTRIES',
        entries: [
          expect.objectContaining({
            activities: [expect.objectContaining({ amount: 25 })],
          }),
        ],
      })
    )
    const dispatched = dispatch.mock.calls[0][0]
    expect(dispatched.entries[0].activities).toHaveLength(1)
  })

  it('manual mode: a row with no activities added is still valid to save, dispatching activities: []', () => {
    const state: AppState = { ...initialState() }
    state.accounts.push(makeAccount({ id: 'acc-1', name: 'Account One', taxCategory: 'taxable' }))

    const dispatch = vi.fn()
    openDialog(state, dispatch)

    const dateInput = screen.getByDisplayValue(todayLocal()) as HTMLInputElement
    const row = dateInput.closest('tr')!
    const [accountSelect] = within(row).getAllByRole('combobox')
    fireEvent.change(accountSelect, { target: { value: 'acc-1' } })
    const balanceInput = within(row).getByPlaceholderText('e.g. 12500.00')
    fireEvent.change(balanceInput, { target: { value: '1000' } })

    const saveBtn = screen.getByText('Save 1 entry')
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(saveBtn)

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_BALANCE_ENTRIES',
        entries: [expect.objectContaining({ activities: [] })],
      })
    )
  })

  describe('edit mode (editingEntry set)', () => {
    function openEditDialog(entry: BalanceEntry, dispatch: (action: any) => void = vi.fn(), state?: AppState) {
      const s: AppState = state ?? { ...initialState() }
      const utils = render(
        <RegisterBalanceDialog state={s} dispatch={dispatch} onClose={vi.fn()} editingEntry={entry} />
      )
      return { ...utils, state: s }
    }

    function baseState(): AppState {
      const s: AppState = { ...initialState() }
      s.accounts.push(makeAccount({ id: 'acc-1', name: 'Account One', taxCategory: 'taxable' }))
      return s
    }

    it('renders one prefilled draft row with 2 activities and no mode toggle / no + Add row button', () => {
      const state = baseState()
      const entry = makeBalanceEntry({
        id: 'bal-1',
        accountId: 'acc-1',
        date: '2024-02-15',
        balance: 4200.75,
        activities: [
          { type: 'Contribution', amount: 100, note: 'first' },
          { type: 'Fee', amount: 25, note: 'second' },
        ],
      })
      openEditDialog(entry, vi.fn(), state)

      const dateInput = screen.getByDisplayValue('2024-02-15') as HTMLInputElement
      const row = dateInput.closest('tr')!
      const table = screen.getByRole('table')
      const selects = within(table).getAllByRole('combobox')
      expect((selects[0] as HTMLSelectElement).value).toBe('acc-1')
      expect(within(row).getByDisplayValue('4200.75')).toBeTruthy()

      const amountInputs = within(table).getAllByPlaceholderText('0.00')
      expect(amountInputs).toHaveLength(2)
      expect((amountInputs[0] as HTMLInputElement).value).toBe('100')
      expect((amountInputs[1] as HTMLInputElement).value).toBe('25')
      const noteInputs = within(table).getAllByPlaceholderText('Note')
      expect((noteInputs[0] as HTMLInputElement).value).toBe('first')
      expect((noteInputs[1] as HTMLInputElement).value).toBe('second')
      expect((selects[1] as HTMLSelectElement).value).toBe('Contribution')
      expect((selects[2] as HTMLSelectElement).value).toBe('Fee')

      expect(screen.queryByText('Enter manually')).toBeNull()
      expect(screen.queryByText('Copy-Paste')).toBeNull()
      expect(screen.queryByText('+ Add row')).toBeNull()
    })

    it('editing the balance and clicking Save changes dispatches UPDATE_BALANCE_ENTRY with the full replacement entry', () => {
      const state = baseState()
      const entry = makeBalanceEntry({
        id: 'bal-1',
        accountId: 'acc-1',
        date: '2024-02-15',
        balance: 4200.75,
        activities: [{ type: 'Contribution', amount: 100, note: 'first' }],
      })
      const dispatch = vi.fn()
      openEditDialog(entry, dispatch, state)

      const dateInput = screen.getByDisplayValue('2024-02-15') as HTMLInputElement
      const row = dateInput.closest('tr')!
      const balanceInput = within(row).getByPlaceholderText('e.g. 12500.00')
      fireEvent.change(balanceInput, { target: { value: '5000' } })

      const saveBtn = screen.getByText('Save changes')
      fireEvent.click(saveBtn)

      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_BALANCE_ENTRY',
        entry: {
          id: 'bal-1',
          accountId: 'acc-1',
          date: '2024-02-15',
          balance: 5000,
          activities: [{ type: 'Contribution', amount: 100, note: 'first' }],
        },
      })
    })

    it('adding then removing an activity before Save results in activities reflecting only final state', () => {
      const state = baseState()
      const entry = makeBalanceEntry({
        id: 'bal-1',
        accountId: 'acc-1',
        date: '2024-02-15',
        balance: 1000,
        activities: [{ type: 'Contribution', amount: 100, note: 'first' }],
      })
      const dispatch = vi.fn()
      openEditDialog(entry, dispatch, state)

      const table = screen.getByRole('table')

      fireEvent.click(within(table).getByText('+ Add activity'))
      let removeBtns = within(table).getAllByTitle('Remove activity')
      expect(removeBtns).toHaveLength(2)
      fireEvent.click(removeBtns[1])

      fireEvent.click(screen.getByText('Save changes'))

      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_BALANCE_ENTRY',
        entry: {
          id: 'bal-1',
          accountId: 'acc-1',
          date: '2024-02-15',
          balance: 1000,
          activities: [{ type: 'Contribution', amount: 100, note: 'first' }],
        },
      })
    })

    it('clicking Delete with confirm=true dispatches DELETE_BALANCE_ENTRY and closes the dialog', () => {
      const state = baseState()
      const entry = makeBalanceEntry({ id: 'bal-1', accountId: 'acc-1', date: '2024-02-15', balance: 1000 })
      const dispatch = vi.fn()
      const onClose = vi.fn()
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      render(<RegisterBalanceDialog state={state} dispatch={dispatch} onClose={onClose} editingEntry={entry} />)

      fireEvent.click(screen.getByText('Delete'))

      expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_BALANCE_ENTRY', id: 'bal-1' })
      expect(onClose).toHaveBeenCalled()
    })

    it('clicking Delete with confirm=false does not dispatch and keeps the dialog open', () => {
      const state = baseState()
      const entry = makeBalanceEntry({ id: 'bal-1', accountId: 'acc-1', date: '2024-02-15', balance: 1000 })
      const dispatch = vi.fn()
      const onClose = vi.fn()
      vi.spyOn(window, 'confirm').mockReturnValue(false)

      render(<RegisterBalanceDialog state={state} dispatch={dispatch} onClose={onClose} editingEntry={entry} />)

      fireEvent.click(screen.getByText('Delete'))

      expect(dispatch).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByText('Delete')).toBeTruthy()
    })

    it('Cancel after adding/removing activities discards all local changes without dispatching', () => {
      const state = baseState()
      const entry = makeBalanceEntry({
        id: 'bal-1',
        accountId: 'acc-1',
        date: '2024-02-15',
        balance: 1000,
        activities: [{ type: 'Contribution', amount: 100, note: 'first' }],
      })
      const dispatch = vi.fn()
      const onClose = vi.fn()

      render(<RegisterBalanceDialog state={state} dispatch={dispatch} onClose={onClose} editingEntry={entry} />)

      const table = screen.getByRole('table')
      fireEvent.click(within(table).getByText('+ Add activity'))

      fireEvent.click(screen.getByText('Cancel'))

      expect(dispatch).not.toHaveBeenCalled()
    })
  })
})
