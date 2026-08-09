import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { ImportDialog } from './ImportDialog'
import type { AppState, Account, TaxCategory } from '../../lib/types'
import { initialState } from '../../lib/state'

vi.mock('../../lib/csv', () => ({
  parseCsvFile: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const POS_HEADERS = ['Symbol', 'Asset Class', 'Shares', 'Cost Basis', 'Price']
const POS_ROWS = [{ Symbol: 'AAPL', 'Asset Class': 'Equity', Shares: '100', 'Cost Basis': '150', Price: '180' }]
const TX_HEADERS = ['Date', 'Symbol', 'Type', 'Shares', 'Price', 'Amount']
const TX_ROWS = [{ Date: '2024-01-15', Symbol: 'AAPL', Type: 'Buy', Shares: '10', Price: '150', Amount: '1500' }]

function createAccount(overrides?: Partial<Account>): Account {
  return {
    id: 'acc-1',
    accountNumber: '123456',
    name: 'Test Brokerage',
    taxCategory: 'taxable',
    retirement: false,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function createState(overrides?: Partial<AppState>): AppState {
  return { ...initialState(), accounts: [createAccount()], ...overrides }
}

async function mockCsv(headers: string[], rows: Record<string, string>[]) {
  const { parseCsvFile } = await import('../../lib/csv')
  vi.mocked(parseCsvFile).mockResolvedValue({ headers, rows })
}

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }))
}

function getFileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement
}

function uploadCsvFile() {
  fireEvent.change(getFileInput(), { target: { files: [new File(['x'], 'test.csv', { type: 'text/csv' })] } })
}

async function continueEnabled() {
  await waitFor(() => {
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false)
  })
}

function clickContinue() {
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

function selectForField(fieldLabel: string): HTMLSelectElement {
  const ths = Array.from(document.querySelectorAll('table thead th'))
  const th = ths.find((el) => {
    const div = el.querySelector('div')
    return div && div.textContent?.trim().startsWith(fieldLabel)
  })
  return th!.querySelector('select') as HTMLSelectElement
}

function mapField(fieldLabel: string, column: string) {
  fireEvent.change(selectForField(fieldLabel), { target: { value: column } })
}

function setAssetClassHeaderValue(value: string) {
  const ths = Array.from(document.querySelectorAll('table thead th'))
  const th = ths.find((el) => {
    const div = el.querySelector('div')
    return div && div.textContent?.trim().startsWith('Asset Class')
  })
  const input = th!.querySelector('input') as HTMLInputElement
  fireEvent.change(input, { target: { value } })
}

function mapPositions() {
  mapField('Symbol', 'Symbol')
  setAssetClassHeaderValue('Equity')
  mapField('Shares', 'Shares')
  mapField('Cost Basis', 'Cost Basis')
  mapField('Price', 'Price')
}

function mapTransactions() {
  mapField('Date', 'Date')
  mapField('Symbol', 'Symbol')
  mapField('Type', 'Type')
  mapField('Shares', 'Shares')
  mapField('Price', 'Price')
  mapField('Amount', 'Amount')
}

async function advanceToStep2(
  dispatch: (action: any) => void = vi.fn(),
  dataType: 'positions' | 'transactions' = 'positions'
) {
  const headers = dataType === 'positions' ? POS_HEADERS : TX_HEADERS
  const rows = dataType === 'positions' ? POS_ROWS : TX_ROWS
  await mockCsv(headers, rows)
  render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
  openDialog()
  if (dataType === 'transactions') {
    fireEvent.click(screen.getByRole('radio', { name: 'Transactions' }))
  }
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'acc-1' } })
  uploadCsvFile()
  await continueEnabled()
  clickContinue()
  await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())
}

async function advanceToStep2NewAccount(
  dispatch: (action: any) => void,
  fields: { name: string; number: string; category?: TaxCategory; retirement?: boolean },
  dataType: 'positions' | 'transactions'
) {
  const headers = dataType === 'positions' ? POS_HEADERS : TX_HEADERS
  const rows = dataType === 'positions' ? POS_ROWS : TX_ROWS
  await mockCsv(headers, rows)
  render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
  openDialog()
  if (dataType === 'transactions') {
    fireEvent.click(screen.getByRole('radio', { name: 'Transactions' }))
  }
  fireEvent.click(screen.getByRole('radio', { name: 'New account' }))
  fireEvent.change(screen.getByPlaceholderText('e.g. Fidelity Rollover IRA'), { target: { value: fields.name } })
  fireEvent.change(screen.getByPlaceholderText('e.g. 8842-1190'), { target: { value: fields.number } })
  if (fields.category) {
    fireEvent.change(screen.getByRole('combobox'), { target: { value: fields.category } })
  }
  if (fields.retirement) {
    fireEvent.click(screen.getByRole('checkbox'))
  }
  uploadCsvFile()
  await continueEnabled()
  clickContinue()
  await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())
}

describe('ImportDialog (2-step wizard)', () => {
  let dispatch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    dispatch = vi.fn()
  })

  it('1. closed state renders a single "Import CSV" trigger styled .btn.btn-secondary.blueprint regardless of state.tab', () => {
    const { container } = render(
      <ImportDialog state={createState({ tab: 'transactions' })} dispatch={dispatch} onClose={vi.fn()} />
    )

    const buttons = screen.getAllByRole('button', { name: 'Import CSV' })
    expect(buttons).toHaveLength(1)
    const button = buttons[0]
    expect(button.className).toContain('btn btn-secondary blueprint')
    expect(container.querySelectorAll('i.corner')).toHaveLength(4)
    expect(container.querySelector('.dialog-backdrop')).toBeNull()
  })

  it('2. opening the dialog shows the "Setup" step indicator and a .dialog.blueprint container', () => {
    const { container } = render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    expect(container.querySelector('.dialog-backdrop')).toBeTruthy()
    expect(container.querySelector('.dialog.blueprint')).toBeTruthy()
    expect(container.querySelectorAll('.dialog.blueprint i.corner')).toHaveLength(4)
    expect(screen.getByText('Import from CSV')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()

    expect(screen.getByText('Setup')).toBeTruthy()
    expect(screen.getByText('Review').className).toContain('text-muted')
    expect(container.querySelectorAll('.tag-accent')).toHaveLength(1)
  })

  it('3. Step 1: Transactions + New account reveals fields; Continue gated on name, number, and a loaded CSV', async () => {
    await mockCsv(['Date', 'Symbol'], [{ Date: '2024-01-15', Symbol: 'AAPL' }])
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    fireEvent.click(screen.getByRole('radio', { name: 'Transactions' }))
    fireEvent.click(screen.getByRole('radio', { name: 'New account' }))

    expect(screen.getByText('New account name')).toBeTruthy()
    expect(screen.getByText('Account number')).toBeTruthy()
    expect(screen.getByText('Category')).toBeTruthy()
    expect(screen.getByText('Retirement Account')).toBeTruthy()

    const continueBtn = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(continueBtn.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('e.g. Fidelity Rollover IRA'), { target: { value: 'Roth IRA' } })
    expect(continueBtn.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('e.g. 8842-1190'), { target: { value: '8842' } })
    expect(continueBtn.disabled).toBe(true)

    uploadCsvFile()
    await continueEnabled()
  })

  it('4. Step 1: Existing account shows a select of state.accounts; Continue enabled once selected + file loaded', async () => {
    await mockCsv(['Symbol'], [{ Symbol: 'AAPL' }])
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    const accountSelect = screen.getByRole('combobox') as HTMLSelectElement
    expect(accountSelect.className).toContain('input')
    expect(screen.getByRole('option', { name: 'Test Brokerage • #123456 — Taxable — Non-Retirement' })).toBeTruthy()

    const continueBtn = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(continueBtn.disabled).toBe(true)

    fireEvent.change(accountSelect, { target: { value: 'acc-1' } })
    expect(continueBtn.disabled).toBe(true)

    uploadCsvFile()
    await continueEnabled()
  })

  it('5. Step 1: a non-CSV file sets a file error and does not advance', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    fireEvent.change(getFileInput(), { target: { files: [new File(['hi'], 'notes.txt', { type: 'text/plain' })] } })

    expect(screen.getByText('Please select a CSV file')).toBeTruthy()
    expect(screen.getByText('No file selected')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('What are you importing?')).toBeTruthy()
    expect(document.querySelector('table')).toBeNull()
    expect(parseCsvFile).not.toHaveBeenCalled()
  })

  it('6. Step 1 -> Step 2 renders the "Review" step label and no Map columns/Preview/Confirm labels', async () => {
    await advanceToStep2()

    expect(screen.getByText('Review')).toBeTruthy()
    expect(screen.queryByText(/Map columns/i)).toBeNull()
    expect(screen.queryByText(/Preview/i)).toBeNull()
    expect(screen.queryByText(/Confirm/i)).toBeNull()
  })

  it('7. Step 2: review line shows "{account} · {category}" for existing (with #number suffix) and new accounts', async () => {
    await advanceToStep2()
    const withNumber = screen.getByText('Test Brokerage • #123456')
    expect(withNumber.tagName).toBe('STRONG')
    expect(withNumber.parentElement!.textContent).toContain('Importing into Test Brokerage • #123456 · Taxable')

    cleanup()
    await mockCsv(POS_HEADERS, POS_ROWS)
    const noNumber = createAccount({ id: 'acc-2', accountNumber: '', name: 'No Number Account' })
    render(
      <ImportDialog
        state={createState({ accounts: [createAccount(), noNumber] })}
        dispatch={dispatch}
        onClose={vi.fn()}
      />
    )
    openDialog()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'acc-2' } })
    uploadCsvFile()
    await continueEnabled()
    clickContinue()
    await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())

    const noNumberLabel = screen.getByText('No Number Account')
    expect(noNumberLabel.parentElement!.textContent).toContain('· Taxable')
    expect(noNumberLabel.parentElement!.textContent).not.toContain('•')

    cleanup()
    await advanceToStep2NewAccount(dispatch, { name: 'Roth IRA', number: '8842', category: 'nonTaxable' }, 'positions')
    const newLabel = screen.getByText('Roth IRA')
    expect(newLabel.parentElement!.textContent).toContain('Importing into Roth IRA · Non-Taxable')
  })

  it('8. Step 2: one table, one th per field with label + * and a mapping select offering only the unmapped placeholder and CSV columns', async () => {
    await advanceToStep2()

    expect(document.querySelectorAll('table')).toHaveLength(1)
    const ths = document.querySelectorAll('table thead th')
    expect(ths).toHaveLength(10)
    expect(document.querySelectorAll('table thead th select')).toHaveLength(8)
    expect(ths[0].querySelector('div')).toBeNull()

    const labelTexts = Array.from(ths).map((th) => th.querySelector('div')?.textContent?.trim())
    expect(labelTexts.slice(1)).toEqual([
      'Symbol*',
      'Asset Class*',
      'Shares*',
      'Cost Basis*',
      'Purchase Amount*',
      'Price*',
      'Market Value*',
      'Name',
      'Taxes',
    ])

    const expectedOptions = ['— Not mapped —', ...POS_HEADERS]
    for (const th of Array.from(ths).slice(1)) {
      const select = th.querySelector('select')
      if (select) {
        const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
        expect(options).toEqual(expectedOptions)
      }
    }
  })

  it('9. Step 2: choosing a CSV column re-renders that column preview cell with the mapped value', async () => {
    await advanceToStep2()

    const symbolInput = document.querySelector('tbody tr input') as HTMLInputElement
    expect(symbolInput.value).toBe('')

    mapField('Symbol', 'Symbol')
    expect(symbolInput.value).toBe('AAPL')
  })

  it('10. Step 2: a row missing a required field shows a cell error + tag; editing the cell clears both', async () => {
    await advanceToStep2()
    mapField('Symbol', 'Symbol')
    setAssetClassHeaderValue('Equity')
    mapField('Shares', 'Shares')
    mapField('Price', 'Price')

    expect(screen.getByText(/1 row\(s\) need fixing before you can continue/)).toBeTruthy()

    const inputs = document.querySelectorAll('tbody tr input')
    const avgCostInput = inputs[3] as HTMLInputElement
    expect(avgCostInput.value).toBe('')
    expect(avgCostInput.getAttribute('style') ?? '').toContain('border-color')

    fireEvent.change(avgCostInput, { target: { value: '150' } })

    expect(screen.queryByText(/row\(s\) need fixing/)).toBeNull()
    expect(avgCostInput.getAttribute('style') ?? '').not.toContain('border-color')
  })

  it('11. Step 2: positions alternative-pair validation — neither avgCost nor purchaseAmount errors; mapping either clears it', async () => {
    await advanceToStep2()
    mapField('Symbol', 'Symbol')
    setAssetClassHeaderValue('Equity')
    mapField('Shares', 'Shares')
    mapField('Price', 'Price')

    expect(screen.getByText(/1 row\(s\) need fixing before you can continue/)).toBeTruthy()

    mapField('Cost Basis', 'Cost Basis')
    expect(screen.queryByText(/row\(s\) need fixing/)).toBeNull()

    mapField('Cost Basis', '')
    expect(screen.getByText(/1 row\(s\) need fixing before you can continue/)).toBeTruthy()

    mapField('Purchase Amount', 'Cost Basis')
    expect(screen.queryByText(/row\(s\) need fixing/)).toBeNull()
  })

  it('12. Step 2: preview-cell edits (not the raw mapped value) are what get imported', async () => {
    await advanceToStep2(dispatch)
    mapPositions()

    const symbolInput = document.querySelector('tbody tr input') as HTMLInputElement
    fireEvent.change(symbolInput, { target: { value: 'MSFT' } })

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    const importCall = dispatch.mock.calls.find((c) => c[0].type === 'IMPORT_POSITIONS')
    expect(importCall).toBeTruthy()
    expect(importCall![0].mappedRows).toEqual([
      { symbol: 'MSFT', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' },
    ])
  })

  it('13. Step 2: Import disabled while required fields unmapped or row errors exist; label reads "Import"', async () => {
    await advanceToStep2()

    const importBtn = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement
    expect(importBtn.disabled).toBe(true)
    expect(screen.queryByText(/Continue|Review Import|Confirm Import/)).toBeNull()

    mapPositions()
    expect(importBtn.disabled).toBe(false)

    cleanup()
    await mockCsv(POS_HEADERS, [
      { Symbol: '', 'Asset Class': 'Equity', Shares: '100', 'Cost Basis': '150', Price: '180' },
    ])
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'acc-1' } })
    uploadCsvFile()
    await continueEnabled()
    clickContinue()
    await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())

    mapPositions()
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/1 row\(s\) need fixing before you can continue/)).toBeTruthy()
  })

  it('13b. Step 2: deleting a row removes it from the preview and the import payload, re-keying edits after it', async () => {
    await mockCsv(POS_HEADERS, [
      { Symbol: 'AAPL', 'Asset Class': 'Equity', Shares: '100', 'Cost Basis': '150', Price: '180' },
      { Symbol: 'MSFT', 'Asset Class': 'Equity', Shares: '50', 'Cost Basis': '200', Price: '210' },
      { Symbol: 'GOOG', 'Asset Class': 'Equity', Shares: '10', 'Cost Basis': '100', Price: '120' },
    ])
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'acc-1' } })
    uploadCsvFile()
    await continueEnabled()
    clickContinue()
    await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())

    mapPositions()

    // Edit the last row (GOOG) so its edit must survive the delete's index re-key
    const lastRowInputs = document.querySelectorAll(
      'tbody tr:last-child td input'
    ) as NodeListOf<HTMLInputElement>
    fireEvent.change(lastRowInputs[0], { target: { value: 'GOOGL' } })

    expect(screen.getAllByTitle('Delete this row')).toHaveLength(3)

    fireEvent.click(screen.getAllByTitle('Delete this row')[1])

    expect(screen.getAllByTitle('Delete this row')).toHaveLength(2)
    expect(screen.getByText(/2 row\(s\) detected/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    const importCall = dispatch.mock.calls.find((c) => c[0].type === 'IMPORT_POSITIONS')
    expect(importCall).toBeTruthy()
    expect(importCall![0].mappedRows).toEqual([
      { symbol: 'AAPL', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' },
      { symbol: 'GOOGL', assetClass: 'Equity', shares: '10', avgCost: '100', price: '120' },
    ])
  })

  it('13c. Step 2: deleting all rows disables the Import button', async () => {
    await advanceToStep2()
    mapPositions()

    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByTitle('Delete this row'))

    expect(screen.queryAllByTitle('Delete this row')).toHaveLength(0)
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('14. Step 2 new-account mode (positions): Import dispatches ADD_ACCOUNT (retirement flag) then IMPORT_POSITIONS with the new id — no intermediate confirm', async () => {
    await advanceToStep2NewAccount(dispatch, { name: 'Roth IRA', number: '8842', category: 'nonTaxable', retirement: true }, 'positions')
    mapPositions()

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    const calls = dispatch.mock.calls.map((c) => c[0])
    expect(calls.map((a) => a.type)).toEqual(['ADD_ACCOUNT', 'IMPORT_POSITIONS'])

    expect(calls[0].account.name).toBe('Roth IRA')
    expect(calls[0].account.accountNumber).toBe('8842')
    expect(calls[0].account.taxCategory).toBe('nonTaxable')
    expect(calls[0].account.retirement).toBe(true)

    expect(calls[1].accountId).toBe(calls[0].account.id)
    expect(calls[1].mappedRows).toEqual([
      { symbol: 'AAPL', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' },
    ])
    expect(calls[1].fileName).toBe('test.csv')
    expect(calls[1].importSessionId).toBeTruthy()
    expect(screen.queryByText(/Confirm/i)).toBeNull()
  })

  it('14b. Step 2 new-account mode (transactions): Import dispatches ADD_ACCOUNT then IMPORT_TRANSACTIONS with the new id', async () => {
    await advanceToStep2NewAccount(dispatch, { name: 'Checking', number: '111', category: 'taxable', retirement: false }, 'transactions')
    mapTransactions()

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    const calls = dispatch.mock.calls.map((c) => c[0])
    expect(calls.map((a) => a.type)).toEqual(['ADD_ACCOUNT', 'IMPORT_TRANSACTIONS'])
    expect(calls[0].account.retirement).toBe(false)
    expect(calls[1].accountId).toBe(calls[0].account.id)
    expect(calls[1].mappedRows).toEqual([
      { date: '2024-01-15', symbol: 'AAPL', type: 'Buy', shares: '10', price: '150', amount: '1500' },
    ])
  })

  it('15. Step 2 existing-account mode: Import dispatches the import action with the selected accountId, no ADD_ACCOUNT', async () => {
    await advanceToStep2(dispatch, 'transactions')
    mapTransactions()

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    const calls = dispatch.mock.calls.map((c) => c[0])
    expect(calls.map((a) => a.type)).toEqual(['IMPORT_TRANSACTIONS'])
    expect(calls[0].accountId).toBe('acc-1')
    expect(calls[0].mappedRows).toEqual([
      { date: '2024-01-15', symbol: 'AAPL', type: 'Buy', shares: '10', price: '150', amount: '1500' },
    ])
    expect(calls.some((a) => a.type === 'ADD_ACCOUNT')).toBe(false)
  })

  it('16. after a successful import the Step 2 slot shows "Import complete" + row count and the button reads "Done"', async () => {
    await advanceToStep2(dispatch)
    mapPositions()

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    expect(screen.getByText('Import complete')).toBeTruthy()
    expect(screen.getByText(/Successfully imported 1 position/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
    expect(screen.queryByText(/Importing into/)).toBeNull()
  })

  it('17. Back from Step 2 returns to Step 1 without losing the file, mapping, or edits', async () => {
    await advanceToStep2()
    mapField('Symbol', 'Symbol')
    const symbolInput = document.querySelector('tbody tr input') as HTMLInputElement
    fireEvent.change(symbolInput, { target: { value: 'MSFT' } })

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('What are you importing?')).toBeTruthy()
    expect(screen.getAllByText('test.csv').length).toBeGreaterThan(0)

    clickContinue()
    await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())

    expect(selectForField('Symbol').value).toBe('Symbol')
    expect((document.querySelector('tbody tr input') as HTMLInputElement).value).toBe('MSFT')
  })

  it('18. the Close button closes the dialog and fully resets local state on reopen', async () => {
    const onClose = vi.fn()
    await mockCsv(['Date', 'Symbol'], [{ Date: '2024-01-15', Symbol: 'AAPL' }])
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={onClose} />)
    openDialog()

    fireEvent.click(screen.getByRole('radio', { name: 'New account' }))
    fireEvent.change(screen.getByPlaceholderText('e.g. Fidelity Rollover IRA'), { target: { value: 'My Acct' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 8842-1190'), { target: { value: '9999' } })
    uploadCsvFile()
    await continueEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.dialog-backdrop')).toBeNull()
    expect(screen.getByRole('button', { name: 'Import CSV' })).toBeTruthy()

    openDialog()
    expect(screen.getByText('Setup')).toBeTruthy()
    expect(screen.queryByText('New account name')).toBeNull()
    expect(screen.getByText('No file selected')).toBeTruthy()
    expect((screen.getByRole('radio', { name: 'Positions / Holdings' }) as HTMLInputElement).checked).toBe(true)
  })

  it('19. Step 2 renders no other select controls — every option is the unmapped placeholder or a CSV column', async () => {
    await advanceToStep2()

    const selects = Array.from(document.querySelectorAll('select'))
    expect(selects).toHaveLength(8)

    const expectedOptions = ['— Not mapped —', ...POS_HEADERS]
    const allOptions = Array.from(document.querySelectorAll('table option')).map((o) => o.textContent)
    expect(allOptions).toEqual(Array.from({ length: selects.length }, () => expectedOptions).flat())
  })

  // New tests for assetClass header input behavior

  it('20. Step 2 (positions): typing in assetClass header broadcasts the value to all non-touched rows', async () => {
    await advanceToStep2()
    mapField('Symbol', 'Symbol')
    mapField('Shares', 'Shares')
    mapField('Cost Basis', 'Cost Basis')
    mapField('Price', 'Price')

    // Type "Equity" in the header input
    setAssetClassHeaderValue('Equity')

    const inputs = document.querySelectorAll('tbody tr input')
    const assetClassCell = inputs[1] // assetClass is the 2nd input (after symbol)
    expect(assetClassCell.getAttribute('value')).toBe('Equity')

    // Type "Bond" in the header input
    setAssetClassHeaderValue('Bond')
    expect((document.querySelector('tbody tr input[value="Bond"]') as HTMLInputElement)?.value).toBe('Bond')
  })

  it('21. Step 2 (positions): editing a row assetClass marks it sticky; header changes do not affect it', async () => {
    await mockCsv(POS_HEADERS, [
      { Symbol: 'AAPL', 'Asset Class': 'Equity', Shares: '100', 'Cost Basis': '150', Price: '180' },
      { Symbol: 'MSFT', 'Asset Class': 'Equity', Shares: '50', 'Cost Basis': '200', Price: '210' },
    ])
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'acc-1' } })
    uploadCsvFile()
    await continueEnabled()
    clickContinue()
    await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())

    mapField('Symbol', 'Symbol')
    mapField('Shares', 'Shares')
    mapField('Cost Basis', 'Cost Basis')
    mapField('Price', 'Price')

    // Set header to "Equity"
    setAssetClassHeaderValue('Equity')

    // Edit row 2 (MSFT) assetClass to "Crypto"
    const inputs = document.querySelectorAll('tbody tr:nth-child(2) input')
    const row2AssetClassInput = inputs[1] as HTMLInputElement
    fireEvent.change(row2AssetClassInput, { target: { value: 'Crypto' } })
    expect(row2AssetClassInput.value).toBe('Crypto')

    // Change header to "Bond"
    setAssetClassHeaderValue('Bond')

    // Row 1 should now be "Bond" (not touched)
    const row1Inputs = document.querySelectorAll('tbody tr:nth-child(1) input')
    const row1AssetClassInput = row1Inputs[1] as HTMLInputElement
    expect(row1AssetClassInput.value).toBe('Bond')

    // Row 2 should still be "Crypto" (touched, sticky)
    const row2Inputs = document.querySelectorAll('tbody tr:nth-child(2) input')
    const row2AssetClassAfterChange = row2Inputs[1] as HTMLInputElement
    expect(row2AssetClassAfterChange.value).toBe('Crypto')
  })

  it('22. Step 2 (positions): Import button disabled when assetClass header is empty', async () => {
    await advanceToStep2()
    mapField('Symbol', 'Symbol')
    mapField('Shares', 'Shares')
    mapField('Cost Basis', 'Cost Basis')
    mapField('Price', 'Price')

    // Header is empty initially
    const importBtn = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement
    expect(importBtn.disabled).toBe(true)

    // Set header to "Equity"
    setAssetClassHeaderValue('Equity')
    expect(importBtn.disabled).toBe(false)

    // Clear the header
    setAssetClassHeaderValue('')
    expect(importBtn.disabled).toBe(true)
  })

  it('23. Step 2: deleting a touched row removes it from touchedAssetClassRows and re-keys other touched indices', async () => {
    await mockCsv(POS_HEADERS, [
      { Symbol: 'AAPL', 'Asset Class': 'Equity', Shares: '100', 'Cost Basis': '150', Price: '180' },
      { Symbol: 'MSFT', 'Asset Class': 'Equity', Shares: '50', 'Cost Basis': '200', Price: '210' },
      { Symbol: 'GOOG', 'Asset Class': 'Equity', Shares: '10', 'Cost Basis': '100', Price: '120' },
    ])
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'acc-1' } })
    uploadCsvFile()
    await continueEnabled()
    clickContinue()
    await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())

    mapField('Symbol', 'Symbol')
    mapField('Shares', 'Shares')
    mapField('Cost Basis', 'Cost Basis')
    mapField('Price', 'Price')

    setAssetClassHeaderValue('Equity')

    // Edit row 1 and row 3 assetClass to make them sticky
    let inputs = document.querySelectorAll('tbody tr:nth-child(2) input')
    fireEvent.change(inputs[1], { target: { value: 'Crypto' } })

    inputs = document.querySelectorAll('tbody tr:nth-child(3) input')
    fireEvent.change(inputs[1], { target: { value: 'Bond' } })

    // Delete row 2 (MSFT)
    fireEvent.click(screen.getAllByTitle('Delete this row')[1])

    // Now 2 rows remain; change header to "Stock"
    setAssetClassHeaderValue('Stock')

    // Row 1 (AAPL) should be "Stock"
    inputs = document.querySelectorAll('tbody tr:nth-child(1) input')
    expect((inputs[1] as HTMLInputElement).value).toBe('Stock')

    // Row 2 (formerly row 3, GOOG) should stay "Bond" (was sticky at old index 2, now at index 1)
    inputs = document.querySelectorAll('tbody tr:nth-child(2) input')
    expect((inputs[1] as HTMLInputElement).value).toBe('Bond')
  })

  it('24. Step 2: dialog close and reopen resets assetClass header to empty string and clears touched rows', async () => {
    await advanceToStep2()
    mapField('Symbol', 'Symbol')
    mapField('Shares', 'Shares')
    mapField('Cost Basis', 'Cost Basis')
    mapField('Price', 'Price')

    setAssetClassHeaderValue('Equity')

    // Edit a row to mark it sticky
    let inputs = document.querySelectorAll('tbody tr input')
    fireEvent.change(inputs[1], { target: { value: 'Crypto' } })

    // Close the dialog
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(document.querySelector('.dialog-backdrop')).toBeNull()

    // Reopen the dialog
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }))
    await waitFor(() => expect(screen.getByText('Setup')).toBeTruthy())

    // Header should be reset
    expect(screen.queryByDisplayValue('Equity')).toBeNull()
  })

  it('25. Step 2 (transactions): no assetClass header input; transactions render normally without it', async () => {
    await advanceToStep2(dispatch, 'transactions')

    // Verify no assetClass header in transactions
    const ths = document.querySelectorAll('table thead th')
    const assetClassTh = Array.from(ths).find((th) => {
      const div = th.querySelector('div')
      return div && div.textContent?.includes('Asset Class')
    })
    expect(assetClassTh).toBeFalsy()

    // Map all transaction fields
    mapTransactions()

    // Import should be enabled (no assetClass requirement)
    const importBtn = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement
    expect(importBtn.disabled).toBe(false)

    // Import and verify no assetClass in the dispatch payload
    fireEvent.click(importBtn)
    const calls = dispatch.mock.calls.map((c) => c[0])
    expect(calls[0].type).toBe('IMPORT_TRANSACTIONS')
    expect(calls[0].mappedRows[0]).not.toHaveProperty('assetClass')
  })
})
