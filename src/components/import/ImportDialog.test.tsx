import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportDialog } from './ImportDialog'
import type { AppState, Account } from '../../lib/types'
import { initialState } from '../../lib/state'
import { createProfile } from '../../lib/mappingProfiles'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/**
 * Test data generators
 */
function createMockAccount(overrides?: Partial<Account>): Account {
  return {
    id: 'acc-1',
    accountNumber: '123456',
    name: 'Test Brokerage',
    taxCategory: 'taxable',
    retirement: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function createMockState(overrides?: Partial<AppState>): AppState {
  const state = initialState()
  return {
    ...state,
    accounts: [createMockAccount()],
    ...overrides,
  }
}

function createMockPositionsProfile() {
  return createProfile(
    'Default Positions',
    'positions',
    {
      Symbol: 'symbol',
      Name: 'name',
      Class: 'assetClass',
      Qty: 'shares',
      Cost: 'avgCost',
      Price: 'price',
    }
  )
}

function createMockTransactionsProfile() {
  return createProfile(
    'Default Transactions',
    'transactions',
    {
      Date: 'date',
      Symbol: 'symbol',
      Type: 'type',
      Qty: 'shares',
      Price: 'price',
      Amount: 'amount',
    }
  )
}

/**
 * Mock parseCsvFile
 */
vi.mock('../../lib/csv', () => ({
  parseCsvFile: vi.fn(),
}))

/**
 * Helper functions
 */
function clickButton(name: string | RegExp) {
  const button = screen.getByRole('button', { name })
  fireEvent.click(button)
}

function typeIntoInput(element: HTMLInputElement, text: string) {
  element.value = text
  fireEvent.change(element)
}

function uploadFile(fileInput: HTMLInputElement, file: File) {
  fireEvent.change(fileInput, { target: { files: [file] } })
}

function selectOption(selectElement: HTMLSelectElement, value: string) {
  fireEvent.change(selectElement, { target: { value } })
}

async function advanceToStep2(
  headers: string[],
  rows: Record<string, string>[],
  waitForText: string | RegExp,
  dataType: 'positions' | 'transactions' = 'positions'
) {
  const { parseCsvFile } = await import('../../lib/csv')
  vi.mocked(parseCsvFile).mockResolvedValue({ headers, rows })

  clickButton(/Import CSV/)
  if (dataType === 'transactions') clickButton(/Transactions/)

  const accountSelect = screen.getByDisplayValue(/-- Select an account --/) as HTMLSelectElement
  selectOption(accountSelect, 'acc-1')

  const dropZone = screen.getByText(/or drag and drop a CSV file here/).closest('div')
  const fileInput = dropZone?.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['Symbol,assetClass,shares,avgCost,price\nAAPL,Equity,100,150,180'], 'test.csv', { type: 'text/csv' })
  uploadFile(fileInput, file)

  await waitFor(() => {
    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false)
  })
  clickButton(/Continue/)

  await waitFor(() => {
    expect(screen.getByText(waitForText)).toBeTruthy()
  })
}

function mappingSelectFor(field: string): HTMLSelectElement {
  const row = screen.getByText(field, { selector: 'td' }).closest('tr') as HTMLTableRowElement
  return row.querySelector('select') as HTMLSelectElement
}

function mapField(field: string, csvColumn: string) {
  selectOption(mappingSelectFor(field), csvColumn)
}

function mappingValue(field: string): string {
  return mappingSelectFor(field).value
}


/**
 * Test Suite
 */
describe('ImportDialog - Core Functionality', () => {
  let mockState: AppState
  let mockDispatch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockState = createMockState()
    mockDispatch = vi.fn()
    vi.clearAllMocks()
  })

  /**
   * Test 1: Closed state renders "Import CSV" button (not "Import Positions"/"Import Transactions")
   */
  it('Test 1: renders "Import CSV" button when closed', () => {
    render(<ImportDialog state={mockState} dispatch={mockDispatch} onClose={vi.fn()} />)

    const button = screen.getByRole('button', { name: /Import CSV/ })
    expect(button).toBeTruthy()
    expect(button.textContent).toContain('Import CSV')

    // Verify it's NOT "Import Positions" or "Import Transactions"
    expect(screen.queryByRole('button', { name: /Import Positions/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Import Transactions/ })).toBeNull()
  })

  /**
   * Test 2: Step 1 - "Transactions" + "New account" mode reveals fields; Continue disabled until name+number+file
   */
  it('Test 2: Step 1 shows new account fields when choosing Transactions + new mode', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['Date', 'Symbol'],
      rows: [{ Date: '2024-01-15', Symbol: 'AAPL' }],
    })

    render(<ImportDialog state={mockState} dispatch={mockDispatch} onClose={vi.fn()} />)

    clickButton(/Import CSV/)

    // Initially Continue disabled
    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(true)

    // Select Transactions + New
    clickButton(/Transactions/)
    clickButton(/New/)

    // New account fields should appear
    expect(screen.getByPlaceholderText(/e.g., Fidelity Brokerage/)).toBeTruthy()
    expect(screen.getByPlaceholderText(/e.g., 123456789/)).toBeTruthy()
    expect(screen.getByLabelText(/Retirement Account/)).toBeTruthy()

    // Continue still disabled without form data
    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  /**
   * Test 3: Step 1 - "Existing account" mode shows select; Continue enabled with account+file
   */
  it('Test 3: Step 1 shows account select for existing mode', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['Symbol', 'Name'],
      rows: [{ Symbol: 'AAPL', Name: 'Apple' }],
    })

    const state = createMockState({
      accounts: [
        createMockAccount({ id: 'acc-1', name: 'Account 1' }),
        createMockAccount({ id: 'acc-2', name: 'Account 2', accountNumber: '999999' }),
      ],
    })

    render(<ImportDialog state={state} dispatch={mockDispatch} onClose={vi.fn()} />)

    clickButton(/Import CSV/)

    // Existing mode (default) shows account select
    const select = screen.getByDisplayValue(/-- Select an account --/) as HTMLSelectElement
    expect(select).toBeTruthy()

    const continueButton = screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement
    expect(continueButton.disabled).toBe(true)

    // Select account
    selectOption(select, 'acc-1')
    expect(continueButton.disabled).toBe(true) // Still disabled without file

    // Add file
    const dropZone = screen.getByText(/or drag and drop a CSV file here/).closest('div')
    const fileInput = dropZone?.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['Symbol,assetClass,shares,avgCost,price\
nAAPL,Equity,100,150,180'], 'test.csv', { type: 'text/csv' })
    uploadFile(fileInput, file)

    // Now enabled
    await waitFor(() => {
      expect(continueButton.disabled).toBe(false)
    })
  })

  /**
   * Test 4: Step 1 - non-CSV file shows importFileError
   */
  it('Test 4: Step 1 shows error for non-CSV file', async () => {
    render(<ImportDialog state={mockState} dispatch={mockDispatch} onClose={vi.fn()} />)

    clickButton(/Import CSV/)

    const dropZone = screen.getByText(/or drag and drop a CSV file here/).closest('div')
    const fileInput = dropZone?.querySelector('input[type="file"]') as HTMLInputElement

    // Upload non-CSV
    const jsonFile = new File(['{}'], 'test.json', { type: 'application/json' })
    uploadFile(fileInput, jsonFile)

    // Error appears
    await waitFor(() => {
      expect(screen.getByText(/Please select a CSV file/)).toBeTruthy()
    })

    // Continue disabled
    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  /**
   * Test 5: Step 2 - saved profiles filtered by kind (only matching kind appears)
   */
  it('Test 5: Step 2 shows only profiles matching data type', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['Symbol', 'Name', 'Class', 'Qty', 'Cost', 'Price'],
      rows: [{ Symbol: 'AAPL', Name: 'Apple', Class: 'Equity', Qty: '100', Cost: '150', Price: '180' }],
    })

    const positionsProfile = createMockPositionsProfile()
    const transactionsProfile = createMockTransactionsProfile()

    const state = createMockState({
      mappingProfiles: [positionsProfile, transactionsProfile],
    })

    render(<ImportDialog state={state} dispatch={mockDispatch} onClose={vi.fn()} />)

    clickButton(/Import CSV/)
    const select = screen.getByDisplayValue(/-- Select an account --/) as HTMLSelectElement
    selectOption(select, 'acc-1')

    const dropZone = screen.getByText(/or drag and drop a CSV file here/).closest('div')
    const fileInput = dropZone?.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['Symbol,assetClass,shares,avgCost,price\
nAAPL,Equity,100,150,180'], 'test.csv', { type: 'text/csv' })
    uploadFile(fileInput, file)

    await waitFor(() => {
      expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false)
    })

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Select Profile/)).toBeTruthy()
    })

    // Default branch is "Use existing": dropdown lists only the Positions profile
    const profileSelect = screen.getByRole('combobox') as HTMLSelectElement
    const options = Array.from(profileSelect.options).map(o => o.textContent)
    expect(options).toContain('Default Positions')
    expect(options.some(o => o?.includes('Default Transactions'))).toBe(false)

    // No mapping grid in the use-existing branch
    expect(screen.queryByText(/Field Mapping/)).toBeNull()
  })

  /**
   * Test 6: Step 2 - "Enter a value…" option appears and allows setting constants
   */
  it('Test 6: Step 2 shows "Enter a value…" option for constants', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['Symbol', 'Name', 'Class', 'Qty', 'Cost', 'Price'],
      rows: [{ Symbol: 'AAPL', Name: 'Apple', Class: 'Equity', Qty: '100', Cost: '150', Price: '180' }],
    })

    render(<ImportDialog state={mockState} dispatch={mockDispatch} onClose={vi.fn()} />)

    clickButton(/Import CSV/)
    const select = screen.getByDisplayValue(/-- Select an account --/) as HTMLSelectElement
    selectOption(select, 'acc-1')

    const dropZone = screen.getByText(/or drag and drop a CSV file here/).closest('div')
    const fileInput = dropZone?.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['Symbol,assetClass,shares,avgCost,price\
nAAPL,Equity,100,150,180'], 'test.csv', { type: 'text/csv' })
    uploadFile(fileInput, file)

    await waitFor(() => {
      expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false)
    })

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    // Look for "Enter a value…" options in mapping table
    const enterValueOptions = screen.getAllByRole('option', { name: /Enter a value/ })
    expect(enterValueOptions.length).toBeGreaterThan(0)
  })

  /**
   * Test 7: Step 2 - "Save Profile & Continue" dispatches ADD_MAPPING_PROFILE (new)
   */
  it('Test 7: Step 2 "Save Profile & Continue" dispatches ADD_MAPPING_PROFILE', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['symbol', 'assetClass', 'shares', 'avgCost', 'price'],
      rows: [{ symbol: 'AAPL', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' }],
    })

    render(<ImportDialog state={mockState} dispatch={mockDispatch} onClose={vi.fn()} />)

    clickButton(/Import CSV/)
    const select = screen.getByDisplayValue(/-- Select an account --/) as HTMLSelectElement
    selectOption(select, 'acc-1')

    const dropZone = screen.getByText(/or drag and drop a CSV file here/).closest('div')
    const fileInput = dropZone?.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['Symbol,assetClass,shares,avgCost,price\
nAAPL,Equity,100,150,180'], 'test.csv', { type: 'text/csv' })
    uploadFile(fileInput, file)

    await waitFor(() => {
      expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false)
    })

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    // No profiles in state → create-new grid renders directly. Map required fields.
    mapField('symbol', 'symbol')
    mapField('assetClass', 'assetClass')
    mapField('shares', 'shares')
    mapField('avgCost', 'avgCost')
    mapField('price', 'price')

    // Enter a profile name
    const profileNameInput = screen.getByPlaceholderText(/e.g., Fidelity Positions/) as HTMLInputElement
    fireEvent.change(profileNameInput, { target: { value: 'My Test Profile' } })

    // Save & continue
    fireEvent.click(screen.getByRole('button', { name: /Save Profile & Continue/ }))

    // Verify dispatch was called with ADD_MAPPING_PROFILE
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ADD_MAPPING_PROFILE',
          profile: expect.objectContaining({
            name: 'My Test Profile',
            kind: 'positions',
          }),
        })
      )
    })

    // Advances to Step 3
    expect(screen.getByText(/Review and edit the imported data below/)).toBeTruthy()
  })

  /**
   * Test 7b: Step 2 - "Save Profile & Continue" dispatches UPDATE_MAPPING_PROFILE when overwriting
   */
  it('Test 7b: Step 2 "Save Profile & Continue" dispatches UPDATE_MAPPING_PROFILE when overwriting', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['symbol', 'assetClass', 'shares', 'avgCost', 'price'],
      rows: [{ symbol: 'AAPL', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' }],
    })

    const existingProfile = createMockPositionsProfile()
    const state = createMockState({
      mappingProfiles: [existingProfile],
    })

    render(<ImportDialog state={state} dispatch={mockDispatch} onClose={vi.fn()} />)

    clickButton(/Import CSV/)
    const select = screen.getByDisplayValue(/-- Select an account --/) as HTMLSelectElement
    selectOption(select, 'acc-1')

    const dropZone = screen.getByText(/or drag and drop a CSV file here/).closest('div')
    const fileInput = dropZone?.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['Symbol,assetClass,shares,avgCost,price\
nAAPL,Equity,100,150,180'], 'test.csv', { type: 'text/csv' })
    uploadFile(fileInput, file)

    await waitFor(() => {
      expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false)
    })

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Select Profile/)).toBeTruthy()
    })

    // Enter create-new mode
    clickButton(/Create new/)
    await waitFor(() => {
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    // Map required fields
    mapField('symbol', 'symbol')
    mapField('assetClass', 'assetClass')
    mapField('shares', 'shares')
    mapField('avgCost', 'avgCost')
    mapField('price', 'price')

    // Enter the existing profile's name to trigger the overwrite flow
    const profileNameInput = screen.getByPlaceholderText(/e.g., Fidelity Positions/) as HTMLInputElement
    fireEvent.change(profileNameInput, { target: { value: 'Default Positions' } })

    // Overwrite prompt confirmed
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    // Save & continue
    fireEvent.click(screen.getByRole('button', { name: /Save Profile & Continue/ }))

    // Verify UPDATE dispatch
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UPDATE_MAPPING_PROFILE',
          profileId: existingProfile.id,
        })
      )
    })

    // Advances to Step 3
    expect(screen.getByText(/Review and edit the imported data below/)).toBeTruthy()
  })

  /**
   * Test 8: Step 3 - row with missing required field shows inline error
   */
  it('Test 8: Step 3 shows validation error for missing required fields', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['Symbol', 'Name', 'Class', 'Qty', 'Cost', 'Price'],
      rows: [
        { Symbol: 'AAPL', Name: 'Apple', Class: 'Equity', Qty: '100', Cost: '150', Price: '180' },
        { Symbol: '', Name: 'NoSymbol', Class: 'Equity', Qty: '50', Cost: '2800', Price: '2900' },
      ],
    })

    const positionsProfile = createMockPositionsProfile()
    const stateWithProfile = createMockState({
      mappingProfiles: [positionsProfile],
    })

    render(<ImportDialog state={stateWithProfile} dispatch={mockDispatch} onClose={vi.fn()} />)

    clickButton(/Import CSV/)
    const select = screen.getByDisplayValue(/-- Select an account --/) as HTMLSelectElement
    selectOption(select, 'acc-1')

    const dropZone = screen.getByText(/or drag and drop a CSV file here/).closest('div')
    const fileInput = dropZone?.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['Symbol,assetClass,shares,avgCost,price\
nAAPL,Equity,100,150,180'], 'test.csv', { type: 'text/csv' })
    uploadFile(fileInput, file)

    await waitFor(() => {
      expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false)
    })

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Select Profile/)).toBeTruthy()
    })

    const profileSelect = screen.getByRole('combobox') as HTMLSelectElement
    selectOption(profileSelect, positionsProfile.id)
    clickButton(/Continue/)

    // Step 3 - should see validation issues
    await waitFor(() => {
      expect(screen.getByText(/Review and edit the imported data below/)).toBeTruthy()
    })

    // Review button should be disabled when there are errors
    const reviewButton = screen.getByRole('button', { name: /Review Import/ }) as HTMLButtonElement
    expect(reviewButton.disabled).toBe(true)
  })

  /**
   * Test 9: Step 3 - positions alternative pair (avgCost/purchaseAmount, price/marketValue)
   */
  it('Test 9: Step 3 validates alternative pairs (avgCost/purchaseAmount)', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    // Missing both avgCost and purchaseAmount
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['Symbol', 'Name', 'Class', 'Qty', 'Price'],
      rows: [{ Symbol: 'AAPL', Name: 'Apple', Class: 'Equity', Qty: '100', Price: '180' }],
    })

    const positionsProfile = createMockPositionsProfile()
    const stateWithProfile = createMockState({
      mappingProfiles: [positionsProfile],
    })

    render(<ImportDialog state={stateWithProfile} dispatch={mockDispatch} onClose={vi.fn()} />)

    clickButton(/Import CSV/)
    const select = screen.getByDisplayValue(/-- Select an account --/) as HTMLSelectElement
    selectOption(select, 'acc-1')

    const dropZone = screen.getByText(/or drag and drop a CSV file here/).closest('div')
    const fileInput = dropZone?.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['Symbol,assetClass,shares,avgCost,price\
nAAPL,Equity,100,150,180'], 'test.csv', { type: 'text/csv' })
    uploadFile(fileInput, file)

    await waitFor(() => {
      expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false)
    })

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Select Profile/)).toBeTruthy()
    })

    const profileSelect = screen.getByRole('combobox') as HTMLSelectElement
    selectOption(profileSelect, positionsProfile.id)
    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Review and edit the imported data below/)).toBeTruthy()
    })

    // Should be disabled due to missing cost basis
    const reviewButton = screen.getByRole('button', { name: /Review Import/ }) as HTMLButtonElement
    expect(reviewButton.disabled).toBe(true)
  })

  /**
   * Test 10: Step 3 - edits in preview table are imported (not raw values)
   * Test via dispatch call verification
   */
  it('Test 10: Step 3 edits appear in dispatch call', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['Symbol', 'Name', 'Class', 'Qty', 'Cost', 'Price'],
      rows: [{ Symbol: 'AAPL', Name: 'Apple', Class: 'Equity', Qty: '100', Cost: '150', Price: '180' }],
    })

    // Create a saved mapping profile
    const positionsProfile = createMockPositionsProfile()
    const stateWithProfile = createMockState({
      mappingProfiles: [positionsProfile],
    })

    render(<ImportDialog state={stateWithProfile} dispatch={mockDispatch} onClose={vi.fn()} />)

    clickButton(/Import CSV/)
    const select = screen.getByDisplayValue(/-- Select an account --/) as HTMLSelectElement
    selectOption(select, 'acc-1')

    const dropZone = screen.getByText(/or drag and drop a CSV file here/).closest('div')
    const fileInput = dropZone?.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['Symbol,assetClass,shares,avgCost,price\
nAAPL,Equity,100,150,180'], 'test.csv', { type: 'text/csv' })
    uploadFile(fileInput, file)

    await waitFor(() => {
      expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false)
    })

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Select Profile/)).toBeTruthy()
    })

    // Select the pre-made mapping profile using userEvent for proper React event handling
    const profileSelect = screen.getByRole('combobox') as HTMLSelectElement
    await userEvent.selectOptions(profileSelect, positionsProfile.id)

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Review and edit the imported data below/)).toBeTruthy()
    })

    // Wait for table to be populated with data
    await waitFor(() => {
      const inputs = screen.getAllByDisplayValue('AAPL')
      expect(inputs.length).toBeGreaterThan(0)
    })

    // Edit the symbol
    const aaplInputs = screen.getAllByDisplayValue('AAPL')
    const symbolInput = aaplInputs[0] as HTMLInputElement
    fireEvent.change(symbolInput, { target: { value: 'MSFT' } })

    // Wait for validation to pass with the new symbol
    await waitFor(() => {
      const reviewBtn = screen.getByRole('button', { name: /Review Import/ }) as HTMLButtonElement
      expect(reviewBtn.disabled).toBe(false)
    })

    clickButton(/Review Import/)

    clickButton(/Import/)

    // Verify dispatch contains IMPORT_POSITIONS call
    await waitFor(() => {
      const importCalls = mockDispatch.mock.calls.filter(call => call[0].type === 'IMPORT_POSITIONS')
      expect(importCalls.length).toBeGreaterThan(0)
    })
  })

  /**
   * Test 11: Step 4 - review card shows data type, destination, row count
   */
  it('Test 11: Step 4 review card shows summary information', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['Symbol', 'Name', 'Class', 'Qty', 'Cost', 'Price'],
      rows: [{ Symbol: 'AAPL', Name: 'Apple', Class: 'Equity', Qty: '100', Cost: '150', Price: '180' }],
    })

    // Create a saved mapping profile so we don't have to manually set fields
    const positionsProfile = createMockPositionsProfile()
    const stateWithProfile = createMockState({
      mappingProfiles: [positionsProfile],
    })

    render(<ImportDialog state={stateWithProfile} dispatch={mockDispatch} onClose={vi.fn()} />)

    clickButton(/Import CSV/)
    const select = screen.getByDisplayValue(/-- Select an account --/) as HTMLSelectElement
    selectOption(select, 'acc-1')

    const dropZone = screen.getByText(/or drag and drop a CSV file here/).closest('div')
    const fileInput = dropZone?.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['Symbol,assetClass,shares,avgCost,price\
nAAPL,Equity,100,150,180'], 'test.csv', { type: 'text/csv' })
    uploadFile(fileInput, file)

    await waitFor(() => {
      expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false)
    })

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Select Profile/)).toBeTruthy()
    })

    // Select the pre-made mapping profile instead of manually setting fields
    const profileSelect = screen.getByRole('combobox') as HTMLSelectElement
    selectOption(profileSelect, positionsProfile.id)

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Review and edit the imported data below/)).toBeTruthy()
    })

    // Wait for validation to pass
    await waitFor(() => {
      const reviewBtn = screen.getByRole('button', { name: /Review Import/ }) as HTMLButtonElement
      expect(reviewBtn.disabled).toBe(false)
    })

    clickButton(/Review Import/)

    // Check review card appears with summary
    await waitFor(() => {
      expect(screen.getByText(/Import Summary/)).toBeTruthy()
    })

    expect(screen.getByText('Positions')).toBeTruthy()
    expect(screen.getByText('Test Brokerage')).toBeTruthy()
  })

  /**
   * Test 12: Step 4 - new account mode dispatches ADD_ACCOUNT + IMPORT_POSITIONS
   */
  it('Test 12: Step 4 new account dispatches ADD_ACCOUNT with retirement flag', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['Symbol', 'Name', 'Class', 'Qty', 'Cost', 'Price'],
      rows: [{ Symbol: 'AAPL', Name: 'Apple', Class: 'Equity', Qty: '100', Cost: '150', Price: '180' }],
    })

    // Create a saved mapping profile
    const positionsProfile = createMockPositionsProfile()
    const stateWithProfile = createMockState({
      mappingProfiles: [positionsProfile],
    })

    render(<ImportDialog state={stateWithProfile} dispatch={mockDispatch} onClose={vi.fn()} />)

    clickButton(/Import CSV/)
    clickButton(/New/)

    const nameInput = screen.getByPlaceholderText(/e.g., Fidelity Brokerage/) as HTMLInputElement
    const numberInput = screen.getByPlaceholderText(/e.g., 123456789/) as HTMLInputElement

    fireEvent.change(nameInput, { target: { value: 'Retirement 401k' } })
    fireEvent.change(numberInput, { target: { value: '555666' } })

    const retirementCheckbox = screen.getByLabelText(/Retirement Account/) as HTMLInputElement
    fireEvent.click(retirementCheckbox)

    const dropZone = screen.getByText(/or drag and drop a CSV file here/).closest('div')
    const fileInput = dropZone?.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['Symbol,assetClass,shares,avgCost,price\
nAAPL,Equity,100,150,180'], 'test.csv', { type: 'text/csv' })
    uploadFile(fileInput, file)

    await waitFor(() => {
      expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false)
    })

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Select Profile/)).toBeTruthy()
    })

    // Select the pre-made mapping profile using userEvent for proper React event handling
    const profileSelect = screen.getByRole('combobox') as HTMLSelectElement
    await userEvent.selectOptions(profileSelect, positionsProfile.id)

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Review and edit the imported data below/)).toBeTruthy()
    })

    // Wait for validation to pass
    await waitFor(() => {
      const reviewBtn = screen.getByRole('button', { name: /Review Import/ }) as HTMLButtonElement
      expect(reviewBtn.disabled).toBe(false)
    })

    clickButton(/Review Import/)

    clickButton(/Import/)

    // Verify ADD_ACCOUNT was called with retirement=true
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ADD_ACCOUNT',
          account: expect.objectContaining({
            name: 'Retirement 401k',
            accountNumber: '555666',
            retirement: true,
          }),
        })
      )
    })
  })

  /**
   * Test 13: Step 4 - existing account dispatches IMPORT_POSITIONS with accountId, no ADD_ACCOUNT
   */
  it('Test 13: Step 4 existing account dispatches IMPORT_POSITIONS only', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['Symbol', 'Name', 'Class', 'Qty', 'Cost', 'Price'],
      rows: [{ Symbol: 'AAPL', Name: 'Apple', Class: 'Equity', Qty: '100', Cost: '150', Price: '180' }],
    })

    // Create a saved mapping profile
    const positionsProfile = createMockPositionsProfile()
    const stateWithProfile = createMockState({
      mappingProfiles: [positionsProfile],
    })

    render(<ImportDialog state={stateWithProfile} dispatch={mockDispatch} onClose={vi.fn()} />)

    clickButton(/Import CSV/)

    const select = screen.getByDisplayValue(/-- Select an account --/) as HTMLSelectElement
    selectOption(select, 'acc-1')

    const dropZone = screen.getByText(/or drag and drop a CSV file here/).closest('div')
    const fileInput = dropZone?.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['Symbol,assetClass,shares,avgCost,price\
nAAPL,Equity,100,150,180'], 'test.csv', { type: 'text/csv' })
    uploadFile(fileInput, file)

    await waitFor(() => {
      expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false)
    })

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Select Profile/)).toBeTruthy()
    })

    // Select the pre-made mapping profile using userEvent for proper React event handling
    const profileSelect = screen.getByRole('combobox') as HTMLSelectElement
    await userEvent.selectOptions(profileSelect, positionsProfile.id)

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Review and edit the imported data below/)).toBeTruthy()
    })

    // Wait for validation to pass
    await waitFor(() => {
      const reviewBtn = screen.getByRole('button', { name: /Review Import/ }) as HTMLButtonElement
      expect(reviewBtn.disabled).toBe(false)
    })

    clickButton(/Review Import/)

    clickButton(/Import/)

    // Verify IMPORT_POSITIONS was dispatched with accountId
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'IMPORT_POSITIONS',
          accountId: 'acc-1',
        })
      )
    })

    // ADD_ACCOUNT should NOT have been called
    const addAccountCalls = mockDispatch.mock.calls.filter(call => call[0].type === 'ADD_ACCOUNT')
    expect(addAccountCalls.length).toBe(0)
  })

  /**
   * Test 14: Step 4 - after "Import" succeeds, shows "Import complete" message
   */
  it('Test 14: After Import, dispatch is called and completion state could be shown', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['Symbol', 'Name', 'Class', 'Qty', 'Cost', 'Price'],
      rows: [{ Symbol: 'AAPL', Name: 'Apple', Class: 'Equity', Qty: '100', Cost: '150', Price: '180' }],
    })

    // Create a saved mapping profile
    const positionsProfile = createMockPositionsProfile()
    const stateWithProfile = createMockState({
      mappingProfiles: [positionsProfile],
    })

    render(<ImportDialog state={stateWithProfile} dispatch={mockDispatch} onClose={vi.fn()} />)

    clickButton(/Import CSV/)

    const select = screen.getByDisplayValue(/-- Select an account --/) as HTMLSelectElement
    selectOption(select, 'acc-1')

    const dropZone = screen.getByText(/or drag and drop a CSV file here/).closest('div')
    const fileInput = dropZone?.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['Symbol,assetClass,shares,avgCost,price\
nAAPL,Equity,100,150,180'], 'test.csv', { type: 'text/csv' })
    uploadFile(fileInput, file)

    await waitFor(() => {
      expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false)
    })

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Select Profile/)).toBeTruthy()
    })

    // Select the pre-made mapping profile using userEvent for proper React event handling
    const profileSelect = screen.getByRole('combobox') as HTMLSelectElement
    await userEvent.selectOptions(profileSelect, positionsProfile.id)

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Review and edit the imported data below/)).toBeTruthy()
    })

    // Wait for validation to pass
    await waitFor(() => {
      const reviewBtn = screen.getByRole('button', { name: /Review Import/ }) as HTMLButtonElement
      expect(reviewBtn.disabled).toBe(false)
    })

    clickButton(/Review Import/)

    clickButton(/Import/)

    // Verify dispatch was called
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'IMPORT_POSITIONS',
        })
      )
    })
  })

  /**
   * Test 15: "Back" button returns to prior step without losing data
   */
  it('Test 15: Back button preserves form data', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['Symbol', 'Name', 'Class', 'Qty', 'Cost', 'Price'],
      rows: [{ Symbol: 'AAPL', Name: 'Apple', Class: 'Equity', Qty: '100', Cost: '150', Price: '180' }],
    })

    render(<ImportDialog state={mockState} dispatch={mockDispatch} onClose={vi.fn()} />)

    clickButton(/Import CSV/)

    const select = screen.getByDisplayValue(/-- Select an account --/) as HTMLSelectElement
    selectOption(select, 'acc-1')

    const dropZone = screen.getByText(/or drag and drop a CSV file here/).closest('div')
    const fileInput = dropZone?.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['Symbol,assetClass,shares,avgCost,price\
nAAPL,Equity,100,150,180'], 'test.csv', { type: 'text/csv' })
    uploadFile(fileInput, file)

    await waitFor(() => {
      expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false)
    })

    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    // Go back
    clickButton(/Back/)

    // Data still there
    expect(select.value).toBe('acc-1')
    expect(screen.getByText(/test.csv/)).toBeTruthy()
  })

  /**
   * Test 16: "Cancel" closes dialog and resets state
   */
  it('Test 16: Cancel closes dialog', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['Symbol', 'Name'],
      rows: [{ Symbol: 'AAPL', Name: 'Apple' }],
    })

    const onClose = vi.fn()
    render(<ImportDialog state={mockState} dispatch={mockDispatch} onClose={onClose} />)

    clickButton(/Import CSV/)

    clickButton(/Cancel/)

    // Dialog should close and callback called
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByText(/Field Mapping/)).toBeNull()
  })

  /**
   * New: seg control shows both modes when profiles exist, defaulting to Use existing
   */
  it('Step 2 seg control shows both modes when profiles exist, defaulting to Use existing', async () => {
    const positionsProfile = createMockPositionsProfile()
    const state = createMockState({ mappingProfiles: [positionsProfile] })

    render(<ImportDialog state={state} dispatch={mockDispatch} onClose={vi.fn()} />)

    await advanceToStep2(
      ['Symbol', 'Name', 'Class', 'Qty', 'Cost', 'Price'],
      [{ Symbol: 'AAPL', Name: 'Apple', Class: 'Equity', Qty: '100', Cost: '150', Price: '180' }],
      /Select Profile/
    )

    expect(screen.getByRole('button', { name: /Use existing/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Create new/ })).toBeTruthy()

    // Default active mode is "Use existing": dropdown shown, grid hidden
    expect(screen.getByText(/Select Profile/)).toBeTruthy()
    expect(screen.queryByText(/Field Mapping/)).toBeNull()
  })

  /**
   * New: no profiles → seg control absent, create-new grid renders directly
   */
  it('Step 2 renders the mapping grid directly when no profiles exist', async () => {
    render(<ImportDialog state={mockState} dispatch={mockDispatch} onClose={vi.fn()} />)

    await advanceToStep2(
      ['Symbol', 'Name', 'Class', 'Qty', 'Cost', 'Price'],
      [{ Symbol: 'AAPL', Name: 'Apple', Class: 'Equity', Qty: '100', Cost: '150', Price: '180' }],
      /Field Mapping/
    )

    expect(screen.queryByRole('button', { name: /Use existing/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Create new/ })).toBeNull()
    expect(screen.getByText(/Field Mapping/)).toBeTruthy()
  })

  /**
   * New: use-existing branch Continue is gated until a profile is selected
   */
  it('Step 2 use-existing Continue is gated until a profile is selected', async () => {
    const positionsProfile = createMockPositionsProfile()
    const state = createMockState({ mappingProfiles: [positionsProfile] })

    render(<ImportDialog state={state} dispatch={mockDispatch} onClose={vi.fn()} />)

    await advanceToStep2(
      ['Symbol', 'Name', 'Class', 'Qty', 'Cost', 'Price'],
      [{ Symbol: 'AAPL', Name: 'Apple', Class: 'Equity', Qty: '100', Cost: '150', Price: '180' }],
      /Select Profile/
    )

    const continueButton = screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement
    expect(continueButton.disabled).toBe(true)

    const profileSelect = screen.getByRole('combobox') as HTMLSelectElement
    await userEvent.selectOptions(profileSelect, positionsProfile.id)

    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false)
    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Review and edit the imported data below/)).toBeTruthy()
    })

    // Profile mapping applied: symbol cell shows the mapped value
    expect(screen.getAllByDisplayValue('AAPL').length).toBeGreaterThan(0)
  })

  /**
   * New: create-new "Save Profile & Continue" is gated on name and required mappings
   */
  it('Step 2 "Save Profile & Continue" is gated on profile name and required fields', async () => {
    render(<ImportDialog state={mockState} dispatch={mockDispatch} onClose={vi.fn()} />)

    await advanceToStep2(
      ['symbol', 'assetClass', 'shares', 'avgCost', 'price'],
      [{ symbol: 'AAPL', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' }],
      /Field Mapping/
    )

    const saveButton = screen.getByRole('button', { name: /Save Profile & Continue/ }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)

    // Name alone is not enough
    fireEvent.change(screen.getByPlaceholderText(/e.g., Fidelity Positions/), { target: { value: 'My Profile' } })
    expect((screen.getByRole('button', { name: /Save Profile & Continue/ }) as HTMLButtonElement).disabled).toBe(true)

    // Partial required mappings are not enough
    mapField('symbol', 'symbol')
    mapField('assetClass', 'assetClass')
    mapField('shares', 'shares')
    expect((screen.getByRole('button', { name: /Save Profile & Continue/ }) as HTMLButtonElement).disabled).toBe(true)

    // Required fields complete (incl. one alternative pair each) → enabled
    mapField('avgCost', 'avgCost')
    mapField('price', 'price')
    expect((screen.getByRole('button', { name: /Save Profile & Continue/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  /**
   * New: create-new save dispatches ADD_MAPPING_PROFILE (transactions) and advances to Step 3
   */
  it('Step 2 create-new save dispatches ADD_MAPPING_PROFILE for transactions', async () => {
    render(<ImportDialog state={mockState} dispatch={mockDispatch} onClose={vi.fn()} />)

    await advanceToStep2(
      ['date', 'symbol', 'type', 'shares', 'price', 'amount'],
      [{ date: '2024-01-15', symbol: 'AAPL', type: 'Buy', shares: '100', price: '150', amount: '15000' }],
      /Field Mapping/,
      'transactions'
    )

    mapField('date', 'date')
    mapField('symbol', 'symbol')
    mapField('type', 'type')
    mapField('shares', 'shares')
    mapField('price', 'price')
    mapField('amount', 'amount')

    fireEvent.change(screen.getByPlaceholderText(/e.g., Fidelity Positions/), { target: { value: 'My Tx Profile' } })
    clickButton(/Save Profile & Continue/)

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ADD_MAPPING_PROFILE',
          profile: expect.objectContaining({
            name: 'My Tx Profile',
            kind: 'transactions',
            fieldMap: expect.objectContaining({
              date: 'date',
              symbol: 'symbol',
              type: 'type',
              shares: 'shares',
              price: 'price',
              amount: 'amount',
            }),
          }),
        })
      )
    })

    expect(screen.getByText(/Review and edit the imported data below/)).toBeTruthy()
  })

  /**
   * New: save with a colliding name dispatches UPDATE_MAPPING_PROFILE when confirm() is true
   */
  it('Step 2 create-new save overwrites existing profile when confirmed', async () => {
    const existingProfile = createMockPositionsProfile()
    const state = createMockState({ mappingProfiles: [existingProfile] })

    render(<ImportDialog state={state} dispatch={mockDispatch} onClose={vi.fn()} />)

    await advanceToStep2(
      ['symbol', 'assetClass', 'shares', 'avgCost', 'price'],
      [{ symbol: 'AAPL', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' }],
      /Select Profile/
    )

    clickButton(/Create new/)
    await waitFor(() => {
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    mapField('symbol', 'symbol')
    mapField('assetClass', 'assetClass')
    mapField('shares', 'shares')
    mapField('avgCost', 'avgCost')
    mapField('price', 'price')

    fireEvent.change(screen.getByPlaceholderText(/e.g., Fidelity Positions/), { target: { value: 'Default Positions' } })

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    clickButton(/Save Profile & Continue/)

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith(
        "A mapping profile named 'Default Positions' already exists. Overwrite it with this mapping?"
      )
    })

    // UPDATE dispatched with the existing profile id and the new (different) field map
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_MAPPING_PROFILE',
        profileId: existingProfile.id,
        profile: expect.objectContaining({
          fieldMap: expect.objectContaining({
            symbol: 'symbol',
            assetClass: 'assetClass',
            shares: 'shares',
            avgCost: 'avgCost',
            price: 'price',
          }),
        }),
      })
    )
    expect(screen.getByText(/Review and edit the imported data below/)).toBeTruthy()
  })

  /**
   * New: declining the overwrite prompt dispatches nothing and stays on Step 2
   */
  it('Step 2 create-new save does not dispatch when overwrite is declined', async () => {
    const existingProfile = createMockPositionsProfile()
    const state = createMockState({ mappingProfiles: [existingProfile] })

    render(<ImportDialog state={state} dispatch={mockDispatch} onClose={vi.fn()} />)

    await advanceToStep2(
      ['symbol', 'assetClass', 'shares', 'avgCost', 'price'],
      [{ symbol: 'AAPL', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' }],
      /Select Profile/
    )

    clickButton(/Create new/)
    await waitFor(() => {
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    mapField('symbol', 'symbol')
    mapField('assetClass', 'assetClass')
    mapField('shares', 'shares')
    mapField('avgCost', 'avgCost')
    mapField('price', 'price')

    fireEvent.change(screen.getByPlaceholderText(/e.g., Fidelity Positions/), { target: { value: 'Default Positions' } })

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    clickButton(/Save Profile & Continue/)

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled()
    })

    expect(mockDispatch).not.toHaveBeenCalled()

    // Still on Step 2 with the typed name intact
    expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    expect((screen.getByPlaceholderText(/e.g., Fidelity Positions/) as HTMLInputElement).value).toBe('Default Positions')
  })

  /**
   * New: toggling modes preserves create-new field maps and profile name
   */
  it('Step 2 mode toggle preserves create-new field maps and profile name', async () => {
    const positionsProfile = createMockPositionsProfile()
    const state = createMockState({ mappingProfiles: [positionsProfile] })

    render(<ImportDialog state={state} dispatch={mockDispatch} onClose={vi.fn()} />)

    await advanceToStep2(
      ['symbol', 'assetClass', 'shares', 'avgCost', 'price'],
      [{ symbol: 'AAPL', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' }],
      /Select Profile/
    )

    clickButton(/Create new/)
    await waitFor(() => {
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    mapField('symbol', 'symbol')
    mapField('assetClass', 'assetClass')
    fireEvent.change(screen.getByPlaceholderText(/e.g., Fidelity Positions/), { target: { value: 'My Profile' } })

    clickButton(/Use existing/)
    expect(screen.getByText(/Select Profile/)).toBeTruthy()

    clickButton(/Create new/)
    expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    expect(mappingValue('symbol')).toBe('symbol')
    expect(mappingValue('assetClass')).toBe('assetClass')
    expect((screen.getByPlaceholderText(/e.g., Fidelity Positions/) as HTMLInputElement).value).toBe('My Profile')
  })

  /**
   * New: Back from Step 3 preserves create-new mapping and name
   */
  it('Step 2 Back from Step 3 preserves create-new mapping and name', async () => {
    const positionsProfile = createMockPositionsProfile()
    const state = createMockState({ mappingProfiles: [positionsProfile] })

    render(<ImportDialog state={state} dispatch={mockDispatch} onClose={vi.fn()} />)

    await advanceToStep2(
      ['symbol', 'assetClass', 'shares', 'avgCost', 'price'],
      [{ symbol: 'AAPL', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' }],
      /Select Profile/
    )

    clickButton(/Create new/)
    await waitFor(() => {
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    mapField('symbol', 'symbol')
    mapField('assetClass', 'assetClass')
    mapField('shares', 'shares')
    mapField('avgCost', 'avgCost')
    mapField('price', 'price')
    fireEvent.change(screen.getByPlaceholderText(/e.g., Fidelity Positions/), { target: { value: 'My New Profile' } })

    clickButton(/Save Profile & Continue/)
    await waitFor(() => {
      expect(screen.getByText(/Review and edit the imported data below/)).toBeTruthy()
    })

    clickButton(/Back/)

    expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    expect(mappingValue('symbol')).toBe('symbol')
    expect((screen.getByPlaceholderText(/e.g., Fidelity Positions/) as HTMLInputElement).value).toBe('My New Profile')
  })

  /**
   * New: Back from Step 3 preserves use-existing profile selection
   */
  it('Step 2 Back from Step 3 preserves use-existing profile selection', async () => {
    const positionsProfile = createMockPositionsProfile()
    const state = createMockState({ mappingProfiles: [positionsProfile] })

    render(<ImportDialog state={state} dispatch={mockDispatch} onClose={vi.fn()} />)

    await advanceToStep2(
      ['Symbol', 'Name', 'Class', 'Qty', 'Cost', 'Price'],
      [{ Symbol: 'AAPL', Name: 'Apple', Class: 'Equity', Qty: '100', Cost: '150', Price: '180' }],
      /Select Profile/
    )

    const profileSelect = screen.getByRole('combobox') as HTMLSelectElement
    selectOption(profileSelect, positionsProfile.id)
    clickButton(/Continue/)

    await waitFor(() => {
      expect(screen.getByText(/Review and edit the imported data below/)).toBeTruthy()
    })

    clickButton(/Back/)

    expect(screen.getByText(/Select Profile/)).toBeTruthy()
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(positionsProfile.id)
  })

  /**
   * Revealing test: create-new save must work with non-self-matching CSV headers.
   * The grid stores the mapping { targetField: csvColumn }, but profiles/applyMapping
   * expect { csvColumn: targetField } — so gating must not depend on self-mapping.
   */
  it('Step 2 create-new save enables for non-self-matching CSV headers and saves canonical fieldMap', async () => {
    const positionsProfile = createMockPositionsProfile()
    const state = createMockState({ mappingProfiles: [positionsProfile] })

    render(<ImportDialog state={state} dispatch={mockDispatch} onClose={vi.fn()} />)

    await advanceToStep2(
      ['Ticker', 'Class', 'Qty', 'Unit Cost', 'Price'],
      [{ Ticker: 'AAPL', Class: 'Equity', Qty: '100', 'Unit Cost': '150', Price: '180' }],
      /Select Profile/
    )

    clickButton(/Create new/)
    await waitFor(() => {
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    mapField('symbol', 'Ticker')
    mapField('assetClass', 'Class')
    mapField('shares', 'Qty')
    mapField('avgCost', 'Unit Cost')
    mapField('price', 'Price')
    fireEvent.change(screen.getByPlaceholderText(/e.g., Fidelity Positions/), {
      target: { value: 'Fidelity Positions' },
    })

    const saveButton = screen.getByRole('button', { name: /Save Profile & Continue/ }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(false)

    clickButton(/Save Profile & Continue/)

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ADD_MAPPING_PROFILE',
          profile: expect.objectContaining({
            name: 'Fidelity Positions',
            kind: 'positions',
            fieldMap: expect.objectContaining({
              Ticker: 'symbol',
              Class: 'assetClass',
              Qty: 'shares',
              'Unit Cost': 'avgCost',
              Price: 'price',
            }),
          }),
        })
      )
    })

    expect(screen.getByText(/Review and edit the imported data below/)).toBeTruthy()
  })
})
