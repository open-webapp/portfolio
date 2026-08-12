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
    institution: 'Fidelity',
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
  fireEvent.click(screen.getByRole('button', { name: 'Accounts & Import' }))
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

/**
 * Helper: simulate pasting text into a drop zone (for paste-mode tests).
 * Creates a paste event with clipboard data and fires it.
 */
function pasteInto(zone: HTMLElement, text: string) {
  const event = new Event('paste', { bubbles: true }) as any
  event.clipboardData = {
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  }
  event.preventDefault = vi.fn()
  fireEvent(zone, event)
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
  fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })
  uploadCsvFile()
  await continueEnabled()
  clickContinue()
  await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())
}

async function advanceToStep2Manual(dispatch: (action: any) => void = vi.fn()) {
  render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
  openDialog()
  fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })
  fireEvent.click(screen.getByRole('radio', { name: 'Enter manually' }))
  await continueEnabled()
  clickContinue()
  await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())
}

async function advanceToStep2NewAccount(
  dispatch: (action: any) => void,
  fields: { name: string; number: string; institution?: string; category?: TaxCategory; retirement?: boolean },
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
  fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: '__new__' } })
  fireEvent.change(screen.getByPlaceholderText('e.g. Fidelity Rollover IRA'), { target: { value: fields.name } })
  fireEvent.change(screen.getByPlaceholderText('e.g. 8842-1190'), { target: { value: fields.number } })
  
  // Select institution from dropdown (2nd select)
  const institutionValue = fields.institution !== undefined ? fields.institution : 'Fidelity'
  const allSelects = document.querySelectorAll('select')
  if (allSelects.length >= 2) {
    fireEvent.change(allSelects[1], { target: { value: institutionValue } })
  }

  // Select category and retirement (3rd and 4th selects)
  if (fields.category && allSelects.length >= 3) {
    fireEvent.change(allSelects[2], { target: { value: fields.category } })
  }
  if (fields.retirement && allSelects.length >= 4) {
    fireEvent.change(allSelects[3], { target: { value: 'retirement' } })
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

  it('1. closed state renders a single "Accounts & Import" trigger styled .btn.btn-secondary.blueprint regardless of state.tab', () => {
    const { container } = render(
      <ImportDialog state={createState({ tab: 'transactions' })} dispatch={dispatch} onClose={vi.fn()} />
    )

    const buttons = screen.getAllByRole('button', { name: 'Accounts & Import' })
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
    expect(container.querySelector('.dialog.blueprint > i.corner.tl')).toBeTruthy()
    expect(container.querySelector('.dialog-title')?.textContent).toBe('Import')
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()

    expect(screen.getByText('Setup')).toBeTruthy()
    expect(screen.getByText('Review').className).toContain('text-muted')
    expect(container.querySelectorAll('.tag-accent')).toHaveLength(1)
  })

  it('3. Step 1: Transactions + New account reveals fields; Continue gated on name, number, institution, and a loaded CSV', async () => {
    await mockCsv(['Date', 'Symbol'], [{ Date: '2024-01-15', Symbol: 'AAPL' }])
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    fireEvent.click(screen.getByRole('radio', { name: 'Transactions' }))

    // Select "+ Add new account..." from the account dropdown
    const accountSelect = document.querySelector('select') as HTMLSelectElement
    fireEvent.change(accountSelect, { target: { value: '__new__' } })

    expect(screen.getByText('Account name')).toBeTruthy()
    expect(screen.getByText('Account number')).toBeTruthy()
    expect(screen.getByText('Institution')).toBeTruthy()
    // Check for Category and Retirement labels in the form
    const labels = screen.getAllByText(/^(Category|Retirement)$/)
    expect(labels.some(l => l.textContent === 'Category')).toBe(true)
    expect(labels.some(l => l.textContent === 'Retirement')).toBe(true)

    const continueBtn = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(continueBtn.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('e.g. Fidelity Rollover IRA'), { target: { value: 'Roth IRA' } })
    expect(continueBtn.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('e.g. 8842-1190'), { target: { value: '8842' } })
    expect(continueBtn.disabled).toBe(true)

    uploadCsvFile()
    expect(continueBtn.disabled).toBe(true) // Still disabled without institution

    // Fill in institution via the institution select dropdown
    const institutionSelect = document.querySelectorAll('select')[1] as HTMLSelectElement
    fireEvent.change(institutionSelect, { target: { value: 'Fidelity' } })
    await continueEnabled()
  })

  it('4. Step 1: Existing account shows a select of state.accounts; Continue enabled once selected + file loaded', async () => {
    await mockCsv(['Symbol'], [{ Symbol: 'AAPL' }])
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    const accountSelect = document.querySelector('select') as HTMLSelectElement as HTMLSelectElement
    expect(accountSelect.className).toContain('input')
    expect(screen.getByRole('option', { name: 'Test Brokerage • #123456 — Fidelity' })).toBeTruthy()

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
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-2' } })
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
    expect(ths).toHaveLength(9)
    expect(document.querySelectorAll('table thead th select')).toHaveLength(7)
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
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })
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
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })
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
    expect(calls.map((a) => a.type)).toEqual(['ADD_ACCOUNT', 'IMPORT_POSITIONS', 'UPSERT_CSV_MAPPING'])

    expect(calls[0].account.name).toBe('Roth IRA')
    expect(calls[0].account.accountNumber).toBe('8842')
    expect(calls[0].account.taxCategory).toBe('nonTaxable')
    expect(calls[0].account.retirement).toBe(true)

    expect(calls[1].accountId).toBe(calls[0].account.id)
    expect(calls[1].mappedRows).toEqual([
      { symbol: 'AAPL', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' },
    ])
    expect(calls[1].fileName).toBe('test.csv')
    expect(screen.queryByText(/Confirm/i)).toBeNull()
  })

  it('14b. Step 2 new-account mode (transactions): Import dispatches ADD_ACCOUNT then IMPORT_TRANSACTIONS with the new id', async () => {
    await advanceToStep2NewAccount(dispatch, { name: 'Checking', number: '111', category: 'taxable', retirement: false }, 'transactions')
    mapTransactions()

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    const calls = dispatch.mock.calls.map((c) => c[0])
    expect(calls.map((a) => a.type)).toEqual(['ADD_ACCOUNT', 'IMPORT_TRANSACTIONS', 'UPSERT_CSV_MAPPING'])
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
    expect(calls.map((a) => a.type)).toEqual(['IMPORT_TRANSACTIONS', 'UPSERT_CSV_MAPPING'])
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

    // Select "+ Add new account..." from the account dropdown
    const accountSelect = document.querySelector('select') as HTMLSelectElement
    fireEvent.change(accountSelect, { target: { value: '__new__' } })

    fireEvent.change(screen.getByPlaceholderText('e.g. Fidelity Rollover IRA'), { target: { value: 'My Acct' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 8842-1190'), { target: { value: '9999' } })

    // Fill in institution via select dropdown
    const institutionSelect = document.querySelectorAll('select')[1] as HTMLSelectElement
    fireEvent.change(institutionSelect, { target: { value: 'Fidelity' } })

    uploadCsvFile()
    await continueEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.dialog-backdrop')).toBeNull()
    expect(screen.getByRole('button', { name: 'Accounts & Import' })).toBeTruthy()

    openDialog()
    expect(screen.getByText('Setup')).toBeTruthy()
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('')
    expect(screen.getByText('No file selected')).toBeTruthy()
    expect((screen.getByRole('radio', { name: 'Positions / Holdings' }) as HTMLInputElement).checked).toBe(true)
  })

  it('19. Step 2 renders no other select controls — every option is the unmapped placeholder or a CSV column', async () => {
    await advanceToStep2()

    const selects = Array.from(document.querySelectorAll('select'))
    expect(selects).toHaveLength(7)

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
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })
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
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })
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
    fireEvent.click(screen.getByRole('button', { name: 'Accounts & Import' }))
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

  // Mapping persistence tests

  it('26. new-account-save: Import via new account records UPSERT_CSV_MAPPING with the newly-created account id (not empty/undefined)', async () => {
    await advanceToStep2NewAccount(dispatch, { name: 'New Brokerage', number: '999', category: 'taxable', retirement: false }, 'positions')
    mapPositions()

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    const calls = dispatch.mock.calls.map((c) => c[0])
    const upsertCall = calls.find((c) => c.type === 'UPSERT_CSV_MAPPING')
    expect(upsertCall).toBeTruthy()

    // Verify the accountId is not empty and matches the newly-created account id from ADD_ACCOUNT
    const addAccountCall = calls.find((c) => c.type === 'ADD_ACCOUNT')
    expect(upsertCall.accountId).toBe(addAccountCall.account.id)
    expect(upsertCall.accountId).toBeTruthy()
    expect(upsertCall.accountId).not.toBe('')
    expect(upsertCall.kind).toBe('positions')
    // Asset Class is handled via header input, not CSV column mapping, so not in fieldMap
    expect(upsertCall.fieldMap).toEqual({
      Symbol: 'symbol',
      Shares: 'shares',
      'Cost Basis': 'avgCost',
      Price: 'price',
    })
  })

  it('27. existing-account prefill: saved mapping is loaded and field selects are pre-selected for matching CSV columns', async () => {
    const savedMapping = {
      id: 'map-1',
      accountId: 'acc-1',
      kind: 'transactions' as const,
      fieldMap: {
        Date: 'date',
        Symbol: 'symbol',
        Type: 'type',
        Shares: 'shares',
        Price: 'price',
        Amount: 'amount',
      },
      updatedAt: new Date().toISOString(),
    }
    const stateWithMapping = createState({ csvMappings: [savedMapping] })

    await mockCsv(TX_HEADERS, TX_ROWS)
    render(<ImportDialog state={stateWithMapping} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()
    fireEvent.click(screen.getByRole('radio', { name: 'Transactions' }))
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })
    uploadCsvFile()
    await continueEnabled()
    clickContinue()
    await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())

    // Verify the selects are pre-selected from saved mapping
    expect(selectForField('Date').value).toBe('Date')
    expect(selectForField('Symbol').value).toBe('Symbol')
    expect(selectForField('Type').value).toBe('Type')
    expect(selectForField('Shares').value).toBe('Shares')
    expect(selectForField('Price').value).toBe('Price')
    expect(selectForField('Amount').value).toBe('Amount')
  })

  it('28. header-mismatch partial-apply: saved mapping with non-existent CSV column stays unmapped; other columns still prefill', async () => {
    const savedMapping = {
      id: 'map-1',
      accountId: 'acc-1',
      kind: 'transactions' as const,
      fieldMap: {
        Date: 'date',
        Symbol: 'symbol',
        Type: 'type',
        'Old Column Name': 'amount', // This column doesn't exist in the current CSV
        Shares: 'shares',
        Price: 'price',
      },
      updatedAt: new Date().toISOString(),
    }
    const stateWithMapping = createState({ csvMappings: [savedMapping] })

    // CSV has different headers - 'Old Column Name' is not present, but 'Amount' is there instead
    await mockCsv(TX_HEADERS, TX_ROWS)
    render(<ImportDialog state={stateWithMapping} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()
    fireEvent.click(screen.getByRole('radio', { name: 'Transactions' }))
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })
    uploadCsvFile()
    await continueEnabled()
    clickContinue()
    await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())

    // Verify that existing columns are prefilled
    expect(selectForField('Date').value).toBe('Date')
    expect(selectForField('Symbol').value).toBe('Symbol')
    expect(selectForField('Type').value).toBe('Type')
    expect(selectForField('Shares').value).toBe('Shares')
    expect(selectForField('Price').value).toBe('Price')

    // Amount should not be mapped (because 'Old Column Name' doesn't exist in the CSV, and Amount is a new column not in the saved mapping)
    expect(selectForField('Amount').value).toBe('')
  })

  it('29. upsert-on-reimport: second import with different mapping replaces the first; state has exactly one entry per account+kind', async () => {
    // First import with mapping A (only some fields mapped)
    const mappingA = {
      id: 'map-1',
      accountId: 'acc-1',
      kind: 'transactions' as const,
      fieldMap: {
        Date: 'date',
        Symbol: 'symbol',
        // Type and others not mapped in mapping A
      },
      updatedAt: new Date().toISOString(),
    }
    const stateAfterFirstImport = createState({ csvMappings: [mappingA] })

    dispatch = vi.fn()
    await mockCsv(TX_HEADERS, TX_ROWS)
    render(<ImportDialog state={stateAfterFirstImport} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()
    fireEvent.click(screen.getByRole('radio', { name: 'Transactions' }))
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })
    uploadCsvFile()
    await continueEnabled()
    clickContinue()
    await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())

    // Import with different mapping (mapping B - all fields mapped)
    mapTransactions()
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    const calls = dispatch.mock.calls.map((c) => c[0])
    const upsertCall = calls.find((c) => c.type === 'UPSERT_CSV_MAPPING')
    expect(upsertCall).toBeTruthy()
    expect(upsertCall.accountId).toBe('acc-1')
    expect(upsertCall.kind).toBe('transactions')
    // Mapping B should have all fields mapped (unlike mapping A which had only Date and Symbol)
    expect(upsertCall.fieldMap).toEqual({
      Date: 'date',
      Symbol: 'symbol',
      Type: 'type',
      Shares: 'shares',
      Price: 'price',
      Amount: 'amount',
    })
  })

  it('30. new-account mode never reads saved mappings: field selects open empty even with saved mappings present', async () => {
    const savedMapping = {
      id: 'map-1',
      accountId: 'acc-1',
      kind: 'transactions' as const,
      fieldMap: {
        Date: 'date',
        Symbol: 'symbol',
        Type: 'type',
        Shares: 'shares',
        Price: 'price',
        Amount: 'amount',
      },
      updatedAt: new Date().toISOString(),
    }
    const stateWithMapping = createState({ csvMappings: [savedMapping] })

    dispatch = vi.fn()
    const headers = TX_HEADERS
    const rows = TX_ROWS
    await mockCsv(headers, rows)
    render(<ImportDialog state={stateWithMapping} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()
    fireEvent.click(screen.getByRole('radio', { name: 'Transactions' }))

    // Select "+ Add new account..." from the dropdown
    const accountSelect = document.querySelector('select') as HTMLSelectElement
    fireEvent.change(accountSelect, { target: { value: '__new__' } })

    fireEvent.change(screen.getByPlaceholderText('e.g. Fidelity Rollover IRA'), { target: { value: 'Fresh Account' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 8842-1190'), { target: { value: '777' } })

    // Fill in institution via select dropdown
    const selects = document.querySelectorAll('select')
    if (selects.length >= 2) {
      fireEvent.change(selects[1], { target: { value: 'Fidelity' } })
    }

    uploadCsvFile()
    await continueEnabled()
    clickContinue()
    await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())

    // Verify all field selects are unmapped (not prefilled from the saved mapping, even though one exists for acc-1)
    expect(selectForField('Date').value).toBe('')
    expect(selectForField('Symbol').value).toBe('')
    expect(selectForField('Type').value).toBe('')
    expect(selectForField('Shares').value).toBe('')
    expect(selectForField('Price').value).toBe('')
    expect(selectForField('Amount').value).toBe('')
  })

  it('31. entry-mode seg: 3 radios render for positions only (Upload CSV file, Copy-Paste, Enter manually); transactions hides them', () => {
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    expect(screen.getByRole('radio', { name: 'Upload CSV file' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Copy-Paste' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Enter manually' })).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: 'Transactions' }))

    expect(screen.queryByRole('radio', { name: 'Upload CSV file' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Copy-Paste' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Enter manually' })).toBeNull()
  })

  it('32. manual mode hides CSV field and enables Continue once account is resolved', async () => {
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    fireEvent.click(screen.getByRole('radio', { name: 'Enter manually' }))
    expect(screen.queryByText('CSV file')).toBeNull()
    expect(document.querySelector('input[type="file"]')).toBeNull()

    const continueBtn = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(continueBtn.disabled).toBe(true)

    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })
    await continueEnabled()
  })

  it('33. switching from positions manual to transactions resets to upload when switching back', () => {
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    fireEvent.click(screen.getByRole('radio', { name: 'Enter manually' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Transactions' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Positions / Holdings' }))

    const upload = screen.getByRole('radio', { name: 'Upload CSV file' }) as HTMLInputElement
    const paste = screen.getByRole('radio', { name: 'Copy-Paste' }) as HTMLInputElement
    const manual = screen.getByRole('radio', { name: 'Enter manually' }) as HTMLInputElement
    expect(upload.checked).toBe(true)
    expect(paste.checked).toBe(false)
    expect(manual.checked).toBe(false)
  })

  it('33b. clicking Copy-Paste after uploading clears csvRows and disables Continue', async () => {
    await mockCsv(POS_HEADERS, POS_ROWS)
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })
    uploadCsvFile()
    await continueEnabled()

    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false)

    // Click Copy-Paste radio to switch modes
    fireEvent.click(screen.getByRole('radio', { name: 'Copy-Paste' }))

    // Continue should now be disabled because csvRows is cleared
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('34. manual continue seeds 10 blank rows in Step 2 and renders no column-mapping selects', async () => {
    await advanceToStep2Manual()

    expect(document.querySelectorAll('tbody tr')).toHaveLength(10)
    expect(document.querySelectorAll('table thead th select')).toHaveLength(0)

    const firstRowInputs = document.querySelectorAll('tbody tr:first-child input') as NodeListOf<HTMLInputElement>
    expect(firstRowInputs[0].value).toBe('')
    expect(firstRowInputs[1].value).toBe('')
  })

  it('35. manual import dispatches IMPORT_POSITIONS rows and skips UPSERT_CSV_MAPPING', async () => {
    await advanceToStep2Manual(dispatch)

    setAssetClassHeaderValue('Equity')
    const firstRowInputs = document.querySelectorAll('tbody tr:first-child input') as NodeListOf<HTMLInputElement>
    fireEvent.change(firstRowInputs[0], { target: { value: 'AAPL' } })
    fireEvent.change(firstRowInputs[2], { target: { value: '100' } })
    fireEvent.change(firstRowInputs[3], { target: { value: '150' } })
    fireEvent.change(firstRowInputs[5], { target: { value: '180' } })

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    const calls = dispatch.mock.calls.map((c) => c[0])
    expect(calls.map((a) => a.type)).toEqual(['IMPORT_POSITIONS'])
    expect(calls[0].mappedRows).toEqual([
      { symbol: 'AAPL', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' },
    ])
  })

  // Regression: manual entry and Copy-Paste are inherently partial batches (adding one
  // position, not re-supplying the whole account) so they must dispatch mode: 'merge'
  // (upsert by symbol) rather than the CSV-upload default of replacing the whole account.
  it("35b. manual import dispatches IMPORT_POSITIONS with mode: 'merge'", async () => {
    await advanceToStep2Manual(dispatch)

    setAssetClassHeaderValue('Equity')
    const firstRowInputs = document.querySelectorAll('tbody tr:first-child input') as NodeListOf<HTMLInputElement>
    fireEvent.change(firstRowInputs[0], { target: { value: 'AAPL' } })
    fireEvent.change(firstRowInputs[2], { target: { value: '100' } })
    fireEvent.change(firstRowInputs[3], { target: { value: '150' } })
    fireEvent.change(firstRowInputs[5], { target: { value: '180' } })

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    const calls = dispatch.mock.calls.map((c) => c[0])
    expect(calls.find((a) => a.type === 'IMPORT_POSITIONS')!.mode).toBe('merge')
  })

  it("13d. CSV-upload import dispatches IMPORT_POSITIONS with mode: 'replace'", async () => {
    await mockCsv(POS_HEADERS, POS_ROWS)
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })
    uploadCsvFile()
    await continueEnabled()
    clickContinue()

    mapField('Symbol', 'Symbol')
    mapField('Shares', 'Shares')
    mapField('Cost Basis', 'Cost Basis')
    mapField('Price', 'Price')
    setAssetClassHeaderValue('Equity')

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    const calls = dispatch.mock.calls.map((c) => c[0])
    expect(calls.find((a) => a.type === 'IMPORT_POSITIONS')!.mode).toBe('replace')
  })

  it('36. manual Import stays disabled while all rows are blank and enables once one valid row exists', async () => {
    await advanceToStep2Manual()

    const importBtn = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement
    expect(importBtn.disabled).toBe(true)

    setAssetClassHeaderValue('Equity')
    expect(importBtn.disabled).toBe(true)

    const firstRowInputs = document.querySelectorAll('tbody tr:first-child input') as NodeListOf<HTMLInputElement>
    fireEvent.change(firstRowInputs[0], { target: { value: 'AAPL' } })
    fireEvent.change(firstRowInputs[2], { target: { value: '100' } })
    fireEvent.change(firstRowInputs[3], { target: { value: '150' } })
    fireEvent.change(firstRowInputs[5], { target: { value: '180' } })

    expect(importBtn.disabled).toBe(false)
  })

  it('37. manual mode row delete works and re-keys remaining rows', async () => {
    await advanceToStep2Manual()

    const firstRowInputs = document.querySelectorAll('tbody tr:first-child input') as NodeListOf<HTMLInputElement>
    fireEvent.change(firstRowInputs[0], { target: { value: 'AAPL' } })

    fireEvent.click(screen.getAllByTitle('Delete this row')[0])

    expect(document.querySelectorAll('tbody tr')).toHaveLength(9)
    const newFirstRowInputs = document.querySelectorAll('tbody tr:first-child input') as NodeListOf<HTMLInputElement>
    expect(newFirstRowInputs[0].value).toBe('')
  })

  it('38. trigger and dialog copy - trigger says "Accounts & Import", dialog says "Import"', () => {
    const { container } = render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    const closedTrigger = screen.getByRole('button', { name: 'Accounts & Import' })
    expect(closedTrigger).toBeTruthy()
    expect(closedTrigger.getAttribute('aria-label')).toBe('Accounts & Import')

    openDialog()
    expect(container.querySelector('.dialog-title')?.textContent).toBe('Import')
  })

  // ============================================================================
  // PASTE-MODE TESTS (T3-T7: Tests 39-52)
  // ============================================================================
  // Verify the copy-paste entry mode for positions import.
  // Covers: zone rendering, paste event handling, gating (both zones required),
  // ragged-row detection, Continue button state, prefill from saved mappings,
  // and parity with upload-mode Step 2 flow.
  // Helper: pasteInto(zone, text) simulates clipboard paste into a drop zone.

  it('39. paste-mode setup: selecting Copy-Paste shows both headers and values zones with initial prompts', () => {
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    fireEvent.click(screen.getByRole('radio', { name: 'Copy-Paste' }))

    const headersZone = screen.getByTestId('paste-headers-zone')
    const valuesZone = screen.getByTestId('paste-values-zone')

    expect(headersZone).toBeTruthy()
    expect(valuesZone).toBeTruthy()
    expect(headersZone.textContent).toContain('Click here and press Ctrl+V / ⌘V')
    expect(headersZone.textContent).toContain('Paste the single row of column names')
    expect(valuesZone.textContent).toContain('Click here and press Ctrl+V / ⌘V')
    expect(valuesZone.textContent).toContain('Paste the data rows (no header row)')
  })

  it('40. paste-headers: pasting tab-separated values into headers zone updates prompt', () => {
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    fireEvent.click(screen.getByRole('radio', { name: 'Copy-Paste' }))
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })

    const headersZone = screen.getByTestId('paste-headers-zone') as HTMLDivElement
    pasteInto(headersZone, 'a\tb')

    expect(headersZone.textContent).toContain('2 columns pasted — click to replace')
  })

  it('41. paste-values: pasting data rows after headers updates values prompt', () => {
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    fireEvent.click(screen.getByRole('radio', { name: 'Copy-Paste' }))
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })

    const headersZone = screen.getByTestId('paste-headers-zone') as HTMLDivElement
    const valuesZone = screen.getByTestId('paste-values-zone') as HTMLDivElement

    pasteInto(headersZone, 'a\tb')
    pasteInto(valuesZone, '1\t2')

    expect(valuesZone.textContent).toContain('1 rows pasted — click to replace')
  })

  it('42. paste-edge: pasting into values before headers are populated stays empty and does not crash', () => {
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    fireEvent.click(screen.getByRole('radio', { name: 'Copy-Paste' }))
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })

    const valuesZone = screen.getByTestId('paste-values-zone') as HTMLDivElement

    // Paste into values zone without first pasting headers
    pasteInto(valuesZone, '1\t2')

    // Zone should still show initial prompt (no change)
    expect(valuesZone.textContent).toContain('Click here and press Ctrl+V / ⌘V')
    // No crash, dialog still renders
    expect(screen.getByText('Setup')).toBeTruthy()
  })

  it('43. paste-issues: pasting ragged rows displays issues warning with correct count', () => {
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    fireEvent.click(screen.getByRole('radio', { name: 'Copy-Paste' }))
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })

    const headersZone = screen.getByTestId('paste-headers-zone') as HTMLDivElement
    const valuesZone = screen.getByTestId('paste-values-zone') as HTMLDivElement

    pasteInto(headersZone, 'a\tb\tc')
    pasteInto(valuesZone, '1\t2\t3\n4\t5')

    expect(screen.getByText(/1 row\(s\) had an unexpected number of columns and were adjusted/)).toBeTruthy()
  })

  // Paste mode gating tests (T5)

  it('44. paste mode gating: account selected, paste valid headers + valid rows → Continue enabled', async () => {
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    // Select account
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })

    // Switch to paste mode
    fireEvent.click(screen.getByRole('radio', { name: 'Copy-Paste' }))

    const headersZone = screen.getByTestId('paste-headers-zone') as HTMLDivElement
    const valuesZone = screen.getByTestId('paste-values-zone') as HTMLDivElement
    const continueBtn = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement

    pasteInto(headersZone, 'Symbol\tShares\tPrice')

    // Continue should still be disabled (no rows yet)
    expect(continueBtn.disabled).toBe(true)

    pasteInto(valuesZone, 'AAPL\t100\t150')

    // Continue should now be enabled (headers and rows present)
    await continueEnabled()
  })

  it('45. paste mode gating: account selected, only headers pasted (no values) → Continue stays disabled', async () => {
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    // Select account
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })

    // Switch to paste mode
    fireEvent.click(screen.getByRole('radio', { name: 'Copy-Paste' }))

    const headersZone = screen.getByTestId('paste-headers-zone') as HTMLDivElement
    const continueBtn = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement

    pasteInto(headersZone, 'Symbol\tShares\tPrice')

    // Continue should stay disabled (no rows)
    expect(continueBtn.disabled).toBe(true)
  })

  it('46. paste mode gating: account selected, only values pasted (no headers) → Continue stays disabled', async () => {
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    // Select account
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })

    // Switch to paste mode
    fireEvent.click(screen.getByRole('radio', { name: 'Copy-Paste' }))

    const valuesZone = screen.getByTestId('paste-values-zone') as HTMLDivElement
    const continueBtn = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement

    pasteInto(valuesZone, 'AAPL\t100\t150')

    // Continue should stay disabled (no headers, so csvRows stays empty)
    expect(continueBtn.disabled).toBe(true)
  })

  it('47. paste mode gating: switch from paste back to upload after successful paste → Continue disabled until file picked', async () => {
    await mockCsv(POS_HEADERS, POS_ROWS)
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()

    // Select account
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })

    // Switch to paste mode
    fireEvent.click(screen.getByRole('radio', { name: 'Copy-Paste' }))

    const headersZone = screen.getByTestId('paste-headers-zone') as HTMLDivElement
    const valuesZone = screen.getByTestId('paste-values-zone') as HTMLDivElement
    const continueBtn = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement

    pasteInto(headersZone, 'Symbol\tShares\tPrice')
    pasteInto(valuesZone, 'AAPL\t100\t150')

    // Continue should be enabled
    await continueEnabled()

    // Switch back to upload mode
    fireEvent.click(screen.getByRole('radio', { name: 'Upload CSV file' }))

    // Continue should now be disabled (paste state is reset, no file uploaded)
    expect(continueBtn.disabled).toBe(true)

    // Upload a file
    uploadCsvFile()

    // Continue should be enabled again
    await continueEnabled()
  })

  it('48. paste-mode prefill: saved mapping is loaded and field selects are pre-selected for matching pasted headers', async () => {
    const savedMapping = {
      id: 'map-1',
      accountId: 'acc-1',
      kind: 'positions' as const,
      fieldMap: {
        Symbol: 'symbol',
        'Asset Class': 'assetClass',
        Shares: 'shares',
        'Cost Basis': 'avgCost',
        Price: 'price',
      },
      updatedAt: new Date().toISOString(),
    }
    const stateWithMapping = createState({ csvMappings: [savedMapping] })

    render(<ImportDialog state={stateWithMapping} dispatch={vi.fn()} onClose={vi.fn()} />)
    openDialog()
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Copy-Paste' }))

    const headersZone = screen.getByTestId('paste-headers-zone') as HTMLDivElement
    const valuesZone = screen.getByTestId('paste-values-zone') as HTMLDivElement

    pasteInto(headersZone, POS_HEADERS.join('\t'))
    pasteInto(valuesZone, POS_ROWS.map((row) => Object.values(row).join('\t')).join('\n'))

    await continueEnabled()
    clickContinue()
    await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())

    // Verify the selects are pre-selected from saved mapping
    expect(selectForField('Symbol').value).toBe('Symbol')
    expect(selectForField('Shares').value).toBe('Shares')
    expect(selectForField('Cost Basis').value).toBe('Cost Basis')
    expect(selectForField('Price').value).toBe('Price')
  })

  it('49. paste-mode header-mismatch: saved mapping with non-existent pasted column stays unmapped; other columns still prefill', async () => {
    const savedMapping = {
      id: 'map-1',
      accountId: 'acc-1',
      kind: 'positions' as const,
      fieldMap: {
        Symbol: 'symbol',
        'Asset Class': 'assetClass',
        Shares: 'shares',
        'Old Column Name': 'avgCost', // This column doesn't exist in the pasted data
        Price: 'price',
      },
      updatedAt: new Date().toISOString(),
    }
    const stateWithMapping = createState({ csvMappings: [savedMapping] })

    // Pasted headers are missing 'Old Column Name' but have 'Cost Basis' instead
    const pastedHeaders = ['Symbol', 'Asset Class', 'Shares', 'Cost Basis', 'Price']
    const pastedValues = 'AAPL\tEquity\t100\t150\t180'

    render(<ImportDialog state={stateWithMapping} dispatch={vi.fn()} onClose={vi.fn()} />)
    openDialog()
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Copy-Paste' }))

    const headersZone = screen.getByTestId('paste-headers-zone') as HTMLDivElement
    const valuesZone = screen.getByTestId('paste-values-zone') as HTMLDivElement

    pasteInto(headersZone, pastedHeaders.join('\t'))
    pasteInto(valuesZone, pastedValues)

    await continueEnabled()
    clickContinue()
    await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())

    // Verify that existing columns are prefilled
    expect(selectForField('Symbol').value).toBe('Symbol')
    expect(selectForField('Shares').value).toBe('Shares')
    expect(selectForField('Price').value).toBe('Price')

    // Cost Basis should not be mapped (because 'Old Column Name' doesn't exist in the pasted data, and Cost Basis is a new column not in the saved mapping)
    expect(selectForField('Cost Basis').value).toBe('')
  })

  // T7: Step 2 parity check - paste mode should work identically to upload mode through Step 2

  async function advanceToStep2Paste(dispatch: (action: any) => void = vi.fn()) {
    render(<ImportDialog state={createState()} dispatch={dispatch} onClose={vi.fn()} />)
    openDialog()
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'acc-1' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Copy-Paste' }))

    const headersZone = screen.getByTestId('paste-headers-zone') as HTMLDivElement
    const valuesZone = screen.getByTestId('paste-values-zone') as HTMLDivElement

    pasteInto(headersZone, POS_HEADERS.join('\t'))
    pasteInto(valuesZone, POS_ROWS.map((row) => Object.values(row).join('\t')).join('\n'))

    await continueEnabled()
    clickContinue()
    await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())
  }

  // T7 Parity: Tests 50-52 verify paste-mode Step 2 behaves identically to upload-mode.
  // Each test mirrors its upload-mode equivalent (tests 12, 12 edit variant, and 13).

  it('50. T7 parity: paste → Step 2 → map all fields → Import dispatches IMPORT_POSITIONS with correct mappedRows (identical to upload path)', async () => {
    await advanceToStep2Paste(dispatch)

    // Map all required fields (same as test 12)
    mapPositions()

    // Verify that Import is now enabled
    const importBtn = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement
    expect(importBtn.disabled).toBe(false)

    // Click Import and verify dispatch payload
    fireEvent.click(importBtn)
    const importCall = dispatch.mock.calls.find((c) => c[0].type === 'IMPORT_POSITIONS')
    expect(importCall).toBeTruthy()

    // Verify mappedRows shape matches upload path (test 12) exactly
    expect(importCall![0].mappedRows).toEqual([
      { symbol: 'AAPL', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' },
    ])
  })

  it('51. T7 parity: paste → Step 2 → edit preview cell → Import uses edited value (same as test 12)', async () => {
    await advanceToStep2Paste(dispatch)
    mapPositions()

    // Edit the symbol preview cell (same as test 12)
    const symbolInput = document.querySelector('tbody tr input') as HTMLInputElement
    fireEvent.change(symbolInput, { target: { value: 'MSFT' } })

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    const importCall = dispatch.mock.calls.find((c) => c[0].type === 'IMPORT_POSITIONS')
    expect(importCall).toBeTruthy()

    // Verify the edited value is what gets imported (same as test 12)
    expect(importCall![0].mappedRows).toEqual([
      { symbol: 'MSFT', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' },
    ])
  })

  it('52. T7 parity: paste → Step 2 → unmapped required fields disable Import button (same as test 13)', async () => {
    await advanceToStep2Paste(dispatch)

    // Initially, Import button should be disabled (no fields mapped)
    const importBtn = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement
    expect(importBtn.disabled).toBe(true)

    // Map some fields but not all required ones
    mapField('Symbol', 'Symbol')
    setAssetClassHeaderValue('Equity')
    mapField('Shares', 'Shares')
    mapField('Price', 'Price')

    // Should still be disabled (avgCost/purchaseAmount not mapped)
    expect(importBtn.disabled).toBe(true)
    expect(screen.getByText(/1 row\(s\) need fixing before you can continue/)).toBeTruthy()

    // Map the missing field
    mapField('Cost Basis', 'Cost Basis')

    // Now Import should be enabled
    expect(importBtn.disabled).toBe(false)
  })
})
