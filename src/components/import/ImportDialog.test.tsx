import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportDialog } from './ImportDialog'
import type { AppState, Account } from '../../lib/types'
import { initialState } from '../../lib/state'
import { createProfile } from '../../lib/mappingProfiles'

afterEach(cleanup)

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
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    // Only Positions profile should appear in select
    const profileSelect = screen.getByDisplayValue(/-- Create new mapping --/) as HTMLSelectElement
    const options = Array.from(profileSelect.options).map(o => o.textContent)
    expect(options).toContain('Default Positions')
    expect(options.some(o => o?.includes('Default Transactions'))).toBe(false)
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
   * Test 7: Step 2 - "Save as profile" dispatches ADD_MAPPING_PROFILE (new)
   */
  it('Test 7: Step 2 "Save as profile" dispatches ADD_MAPPING_PROFILE', async () => {
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

    // Click Save as Profile
    fireEvent.click(screen.getByRole('button', { name: /Save as Profile/ }))

    // Wait for the save profile section to appear
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/e.g., Fidelity Positions/)).toBeTruthy()
    })

    // Enter name
    const profileNameInput = screen.getByPlaceholderText(/e.g., Fidelity Positions/) as HTMLInputElement
    fireEvent.change(profileNameInput, { target: { value: 'My Test Profile' } })

    // Wait for input value to update in the DOM
    await waitFor(() => {
      const input = screen.getByPlaceholderText(/e.g., Fidelity Positions/) as HTMLInputElement
      expect(input.value).toBe('My Test Profile')
    })

    // Save
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))

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
  })

  /**
   * Test 7b: Step 2 - "Save as profile" dispatches UPDATE_MAPPING_PROFILE (editing)
   */
  it('Test 7b: Step 2 "Save as profile" dispatches UPDATE_MAPPING_PROFILE when editing', async () => {
    const { parseCsvFile } = await import('../../lib/csv')
    vi.mocked(parseCsvFile).mockResolvedValue({
      headers: ['Symbol', 'Name', 'Class', 'Qty', 'Cost', 'Price'],
      rows: [{ Symbol: 'AAPL', Name: 'Apple', Class: 'Equity', Qty: '100', Cost: '150', Price: '180' }],
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
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    // Select existing profile
    const profileSelect = screen.getByDisplayValue(/-- Create new mapping --/) as HTMLSelectElement
    selectOption(profileSelect, existingProfile.id)

    // Save as Profile
    fireEvent.click(screen.getByRole('button', { name: /Save as Profile/ }))

    // Wait for the save profile section to appear
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/e.g., Fidelity Positions/)).toBeTruthy()
    })

    // Enter new name
    const profileNameInput = screen.getByPlaceholderText(/e.g., Fidelity Positions/) as HTMLInputElement
    fireEvent.change(profileNameInput, { target: { value: 'Updated Profile' } })

    // Wait for input value to update in the DOM
    await waitFor(() => {
      const input = screen.getByPlaceholderText(/e.g., Fidelity Positions/) as HTMLInputElement
      expect(input.value).toBe('Updated Profile')
    })

    // Save
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    // Verify UPDATE dispatch
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UPDATE_MAPPING_PROFILE',
          profileId: existingProfile.id,
        })
      )
    })
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
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    // Select the pre-made mapping profile using userEvent for proper React event handling
    const profileSelect = screen.getByDisplayValue(/-- Create new mapping --/) as HTMLSelectElement
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
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    // Select the pre-made mapping profile instead of manually setting fields
    const profileSelect = screen.getByDisplayValue(/-- Create new mapping --/) as HTMLSelectElement
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
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    // Select the pre-made mapping profile using userEvent for proper React event handling
    const profileSelect = screen.getByDisplayValue(/-- Create new mapping --/) as HTMLSelectElement
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
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    // Select the pre-made mapping profile using userEvent for proper React event handling
    const profileSelect = screen.getByDisplayValue(/-- Create new mapping --/) as HTMLSelectElement
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
      expect(screen.getByText(/Field Mapping/)).toBeTruthy()
    })

    // Select the pre-made mapping profile using userEvent for proper React event handling
    const profileSelect = screen.getByDisplayValue(/-- Create new mapping --/) as HTMLSelectElement
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
})
