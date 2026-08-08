import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { initialState } from './lib/state'
import { appReducer } from './lib/reducer'
import { importPositions } from './lib/positionsImport'
import { importTransactions } from './lib/transactionsImport'
import { savePersistedApp } from './lib/persist'
import type { MappingProfile } from './lib/types'
import App, { processPendingImport } from './App'

afterEach(cleanup)

async function clearDatabase() {
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('portfolio_app_state_v1', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = (event) => {
        const target = (event.target as IDBOpenDBRequest).result
        if (!target.objectStoreNames.contains('app_state')) {
          target.createObjectStore('app_state')
        }
      }
    })
    const transaction = db.transaction('app_state', 'readwrite')
    transaction.objectStore('app_state').clear()
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve()
    })
    db.close()
  } catch {
    // Ignore
  }
}

describe('import session creation via processPendingImport', () => {
  it('should create one ImportSession for a positions import with correct metadata', () => {
    let state = initialState()

    // Create an account
    state = appReducer(state, {
      type: 'ADD_ACCOUNT',
      account: {
        id: 'acc-1',
        accountNumber: '12345',
        name: 'Brokerage',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    })

    // Import some positions with a session ID
    const sessionId = 'import-session-1'
    const mappedRows = [
      {
        symbol: 'AAPL',
        name: 'Apple',
        assetClass: 'Equity',
        shares: '100',
        avgCost: '150',
        price: '180',
      },
      {
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: '50',
        avgCost: '300',
        price: '350',
      },
    ]

    state = importPositions(state, 'acc-1', mappedRows, '2024-01-15', sessionId)

    // Now call processPendingImport to create the session
    state = processPendingImport(state, 'positions', 'test.csv', sessionId, new Set(['acc-1']))

    // Verify exactly one ImportSession was created
    expect(state.importSessions).toHaveLength(1)

    // Verify session properties
    const session = state.importSessions[0]
    expect(session.id).toBe(sessionId)
    expect(session.kind).toBe('positions')
    expect(session.fileName).toBe('test.csv')
    expect(session.accountIds).toEqual(['acc-1'])
    expect(session.rowCount).toBe(2) // 2 positions created
    expect(session.importedAt).toBeTruthy()
  })

  it('should create one ImportSession for a transactions import', () => {
    let state = initialState()

    // Create an account
    state = appReducer(state, {
      type: 'ADD_ACCOUNT',
      account: {
        id: 'acc-1',
        accountNumber: '12345',
        name: 'Brokerage',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    })

    // Import some transactions
    const sessionId = 'import-tx-1'
    const mappedRows = [
      {
        date: '2024-01-10',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '100',
        price: '150',
        amount: '15000',
      },
    ]

    state = importTransactions(state, 'acc-1', mappedRows, sessionId)

    // Call processPendingImport
    state = processPendingImport(state, 'transactions', 'transactions.csv', sessionId, new Set(['acc-1']))

    // Verify session
    expect(state.importSessions).toHaveLength(1)
    const session = state.importSessions[0]
    expect(session.kind).toBe('transactions')
    expect(session.fileName).toBe('transactions.csv')
    expect(session.rowCount).toBe(1)
  })

  it('should handle multi-account imports with a single ImportSession', () => {
    let state = initialState()

    // Create two accounts
    state = appReducer(state, {
      type: 'ADD_ACCOUNT',
      account: {
        id: 'acc-1',
        accountNumber: '12345',
        name: 'Brokerage 1',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    })

    state = appReducer(state, {
      type: 'ADD_ACCOUNT',
      account: {
        id: 'acc-2',
        accountNumber: '54321',
        name: 'Brokerage 2',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    })

    // Import positions for both accounts with same session ID
    const sessionId = 'import-multi-1'
    const rows1 = [{ symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' }]
    const rows2 = [{ symbol: 'MSFT', name: 'Microsoft', assetClass: 'Equity', shares: '50', avgCost: '300', price: '350' }]

    state = importPositions(state, 'acc-1', rows1, '2024-01-15', sessionId)
    state = importPositions(state, 'acc-2', rows2, '2024-01-15', sessionId)

    // Create ONE session for both accounts
    state = processPendingImport(state, 'positions', 'multi-account.csv', sessionId, new Set(['acc-1', 'acc-2']))

    // Verify exactly one session with both accounts
    expect(state.importSessions).toHaveLength(1)
    const session = state.importSessions[0]
    expect(session.accountIds.sort()).toEqual(['acc-1', 'acc-2'])
    expect(session.rowCount).toBe(2) // 1 from each account
  })

  it('should tag all imported rows with the correct importSessionId', () => {
    let state = initialState()

    state = appReducer(state, {
      type: 'ADD_ACCOUNT',
      account: {
        id: 'acc-1',
        accountNumber: '12345',
        name: 'Brokerage',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    })

    const sessionId = 'import-tag-1'
    const mappedRows = [
      { symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' },
    ]

    state = importPositions(state, 'acc-1', mappedRows, '2024-01-15', sessionId)

    // Verify rows have the correct importSessionId
    expect(state.positions[0].importSessionId).toBe(sessionId)
    expect(state.snapshots[0].importSessionId).toBe(sessionId)

    // Create session
    state = processPendingImport(state, 'positions', 'test.csv', sessionId, new Set(['acc-1']))

    // Session should have the same ID
    expect(state.importSessions[0].id).toBe(sessionId)
  })

  it('should count closed positions in rowCount for positions import', () => {
    let state = initialState()

    // Create account and import initial positions
    state = appReducer(state, {
      type: 'ADD_ACCOUNT',
      account: {
        id: 'acc-1',
        accountNumber: '12345',
        name: 'Brokerage',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    })

    // First import: AAPL and MSFT
    const sessionId1 = 'import-1'
    state = importPositions(
      state,
      'acc-1',
      [
        { symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' },
        { symbol: 'MSFT', name: 'Microsoft', assetClass: 'Equity', shares: '50', avgCost: '300', price: '350' },
      ],
      '2024-01-15',
      sessionId1
    )

    // Second import: only AAPL (MSFT becomes closed)
    const sessionId2 = 'import-2'
    state = importPositions(
      state,
      'acc-1',
      [{ symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' }],
      '2024-01-20',
      sessionId2
    )

    // At this point, session 2 should have created 1 position (AAPL) and 1 closed position (MSFT)
    state = processPendingImport(state, 'positions', 'update.csv', sessionId2, new Set(['acc-1']))

    // Session should count both open and closed positions
    const session = state.importSessions.find((s) => s.id === sessionId2)
    expect(session).toBeTruthy()
    expect(session!.rowCount).toBe(2) // 1 position + 1 closed position
  })

  it('should evict the oldest session when 51st import is added', () => {
    let state = initialState()

    // Create an account
    state = appReducer(state, {
      type: 'ADD_ACCOUNT',
      account: {
        id: 'acc-1',
        accountNumber: '12345',
        name: 'Brokerage',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    })

    // Add 50 imports
    for (let i = 0; i < 50; i++) {
      const sessionId = `import-${i}`
      const mappedRows = [{ symbol: `SYM${i}`, name: `Symbol ${i}`, assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' }]

      state = importPositions(state, 'acc-1', mappedRows, '2024-01-15', sessionId)
      state = processPendingImport(state, 'positions', `file-${i}.csv`, sessionId, new Set(['acc-1']))
    }

    expect(state.importSessions).toHaveLength(50)
    const firstSessionId = state.importSessions[state.importSessions.length - 1].id

    // Add 51st import
    const sessionId51 = 'import-50'
    const mappedRows = [{ symbol: 'SYM50', name: 'Symbol 50', assetClass: 'Equity', shares: '100', avgCost: '150', price: '180' }]
    state = importPositions(state, 'acc-1', mappedRows, '2024-01-15', sessionId51)
    state = processPendingImport(state, 'positions', 'file-50.csv', sessionId51, new Set(['acc-1']))

    // Should still have exactly 50 sessions
    expect(state.importSessions).toHaveLength(50)

    // The first session should be gone (oldest evicted)
    expect(state.importSessions.map((s) => s.id)).not.toContain(firstSessionId)

    // The 51st should be the newest (at index 0)
    expect(state.importSessions[0].id).toBe(sessionId51)
  })
})

describe('pending import processing', () => {
  it('should import positions when pendingImport is processed', () => {
    let state = initialState()

    // Create an account first
    state = appReducer(state, {
      type: 'ADD_ACCOUNT',
      account: {
        id: 'acc-1',
        accountNumber: '12345',
        name: 'Brokerage',
        taxCategory: 'Taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    })

    // Create a mapping profile that maps to account number column
    const profile: MappingProfile = {
      id: 'map-1',
      name: 'Test Profile',
      kind: 'positions',
      fieldMap: {
        'Account Number': 'accountNumber',
        'Symbol': 'symbol',
        'Name': 'name',
        'Asset Class': 'assetClass',
        'Shares': 'shares',
        'Avg Cost': 'avgCost',
        'Price': 'price',
      },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }

    state = appReducer(state, {
      type: 'ADD_MAPPING_PROFILE',
      profile,
    })

    // Verify account and profile are set up
    expect(state.accounts).toHaveLength(1)
    expect(state.mappingProfiles).toHaveLength(1)

    // Create mapped rows (as they would come from applyMapping)
    const mappedRows = [
      {
        accountNumber: '12345',
        symbol: 'AAPL',
        name: 'Apple',
        assetClass: 'Equities',
        shares: '100',
        avgCost: '150',
        price: '180',
      },
    ]

    // Directly call importPositions (simulating what App.tsx effect would do)
    state = importPositions(state, 'acc-1', mappedRows, '2024-01-15', 'import-test1')

    // Verify positions were imported
    expect(state.positions).toHaveLength(1)
    expect(state.positions[0].symbol).toBe('AAPL')
    expect(state.positions[0].accountId).toBe('acc-1')
    expect(state.positions[0].shares).toBe(100)

    // Verify snapshot was created
    expect(state.snapshots).toHaveLength(1)
    expect(state.snapshots[0].accountId).toBe('acc-1')
  })

  it('should import transactions when pendingImport is processed', () => {
    let state = initialState()

    // Create an account first
    state = appReducer(state, {
      type: 'ADD_ACCOUNT',
      account: {
        id: 'acc-1',
        accountNumber: '12345',
        name: 'Brokerage',
        taxCategory: 'Taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    })

    // Create a mapping profile for transactions
    const profile: MappingProfile = {
      id: 'map-tx-1',
      name: 'Test TX Profile',
      kind: 'transactions',
      fieldMap: {
        'Account Number': 'accountNumber',
        'Date': 'date',
        'Symbol': 'symbol',
        'Type': 'type',
        'Shares': 'shares',
        'Price': 'price',
      },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }

    state = appReducer(state, {
      type: 'ADD_MAPPING_PROFILE',
      profile,
    })

    // Create mapped rows (as they would come from applyMapping)
    const mappedRows = [
      {
        accountNumber: '12345',
        date: '2024-01-10',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '100',
        price: '150',
        amount: '15000',
      },
    ]

    // Directly call importTransactions (simulating what App.tsx effect would do)
    state = importTransactions(state, 'acc-1', mappedRows, 'import-test2')

    // Verify transactions were imported
    expect(state.transactions).toHaveLength(1)
    expect(state.transactions[0].symbol).toBe('AAPL')
    expect(state.transactions[0].accountId).toBe('acc-1')
    expect(state.transactions[0].type).toBe('Buy')
  })
})

describe('end-to-end import via the dialog (real CSV upload, real applyMapping)', () => {
  beforeEach(async () => {
    await clearDatabase()
  })

  // NOTE: These tests are for the old import flow and have been superseded by C11's ImportDialog.test.tsx.
  // The new unified ImportDialog changes the flow significantly (Step 1: pick account, Step 2: map, Step 3: preview, Step 4: confirm).
  // These tests are skipped pending C11 implementation.

  // This test is for the old import flow and has been superseded by C11's ImportDialog.test.tsx
  it.skip('imports positions end-to-end when uploading a CSV through the dialog', async () => {
    const profile: MappingProfile = {
      id: 'map-e2e',
      name: 'E2E Profile',
      kind: 'positions',
      fieldMap: {
        Symbol: 'symbol',
        Name: 'name',
        'Asset Class': 'assetClass',
        Shares: 'shares',
        'Avg Cost': 'avgCost',
        Price: 'price',
      },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }

    await savePersistedApp({
      ...initialState(),
      mappingProfiles: [profile],
    })

    render(<App />)

    fireEvent.click(await screen.findByText('Import Positions'))

    const csv =
      'Account Number,Symbol,Name,Asset Class,Shares,Avg Cost,Price\n' +
      '12345,AAPL,Apple,Equities,100,150,180\n'
    const file = new File([csv], 'positions.csv', { type: 'text/csv' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })

    fireEvent.click(await screen.findByText('E2E Profile'))
    fireEvent.click(await screen.findByText('Import'))

    // First-seen account number should trigger the account-resolve prompt.
    const nameInput = await screen.findByPlaceholderText('e.g., Fidelity Brokerage')
    fireEvent.change(nameInput, { target: { value: 'My Brokerage' } })
    fireEvent.click(screen.getByText('Create Account & Continue'))

    await waitFor(() => expect(screen.getByText('AAPL')).toBeTruthy())
  })

  // First-time user: no mapping profiles exist yet, so they go through
  // "Create New Profile" (MappingProfileEditor) instead of picking an existing one.
  it.skip('imports positions end-to-end via Create New Profile with no prior profiles', async () => {
    await clearDatabase()
    render(<App />)

    fireEvent.click(await screen.findByText('Import Positions'))

    const csv =
      'Account Number,Symbol,Name,Asset Class,Shares,Avg Cost,Price\n' +
      '54321,MSFT,Microsoft,Equities,10,300,350\n'
    const file = new File([csv], 'positions.csv', { type: 'text/csv' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })

    fireEvent.click(await screen.findByText('Create New Profile'))

    // Scope to the editor itself — Nav also renders a <select> (date range) that's
    // always mounted, which would otherwise shift indices in a global combobox query.
    const editor = (await screen.findByText('Mapping Profile Editor')).closest('div')!
    const { getAllByRole } = await import('@testing-library/dom')
    const selects = getAllByRole(editor, 'combobox')
    // Select order follows POSITIONS_REQUIRED_FIELDS then POSITIONS_OPTIONAL_FIELDS,
    // with the "Account Number Column (optional)" picker last.
    // [symbol, assetClass, shares, avgCost, purchaseAmount, price, marketValue, name, taxes, accountNumberColumn]
    fireEvent.change(selects[0], { target: { value: 'Symbol' } })
    fireEvent.change(selects[1], { target: { value: 'Asset Class' } })
    fireEvent.change(selects[2], { target: { value: 'Shares' } })
    fireEvent.change(selects[3], { target: { value: 'Avg Cost' } })
    fireEvent.change(selects[5], { target: { value: 'Price' } })
    fireEvent.change(selects[7], { target: { value: 'Name' } })
    fireEvent.change(selects[selects.length - 1], { target: { value: 'Account Number' } })

    fireEvent.click(screen.getByText('Save Profile'))
    fireEvent.click(await screen.findByText('Import'))

    const nameInput = await screen.findByPlaceholderText('e.g., Fidelity Brokerage')
    fireEvent.change(nameInput, { target: { value: 'New Brokerage' } })
    fireEvent.click(screen.getByText('Create Account & Continue'))

    await waitFor(() => expect(screen.getByText('MSFT')).toBeTruthy())
  })
})

describe('import with no Account Number column mapped', () => {
  beforeEach(async () => {
    await clearDatabase()
  })

  // NOTE: This test is for the old flow with ManualAccountNumberPrompt, which no longer exists.
  // The new unified ImportDialog requires the destination account to be chosen upfront in Step 1,
  // eliminating the need for per-row account resolution. This test is skipped pending C11.

  // Regression: App.tsx used to alert() and discard the parsed CSV whenever the
  // mapping profile had no accountNumberColumn, forcing the user to redo the whole
  // file-picker/profile flow (which would just fail again). It should instead let
  // the user type the account number in and continue the same import.
  it.skip('prompts for a manual account number instead of aborting the import', async () => {
    const profile: MappingProfile = {
      id: 'map-no-acct',
      name: 'No Account Column Profile',
      kind: 'positions',
      fieldMap: {
        Symbol: 'symbol',
        Name: 'name',
        'Asset Class': 'assetClass',
        Shares: 'shares',
        'Avg Cost': 'avgCost',
        Price: 'price',
      },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }

    const seeded = {
      ...initialState(),
      mappingProfiles: [profile],
      pendingImport: {
        kind: 'positions' as const,
        profileId: profile.id,
        rows: [
          {
            symbol: 'AAPL',
            name: 'Apple',
            assetClass: 'Equities',
            shares: '100',
            avgCost: '150',
            price: '180',
          },
        ],
      },
    }
    await savePersistedApp(seeded)

    render(<App />)

    // The prompt to type in an account number should appear (not a blocking alert).
    const input = await screen.findByPlaceholderText('e.g., 12345678')
    fireEvent.change(input, { target: { value: '999888' } })
    fireEvent.click(screen.getByText('Continue'))

    // A new account should then be created for the typed-in number.
    const nameInput = await screen.findByPlaceholderText('e.g., Fidelity Brokerage')
    fireEvent.change(nameInput, { target: { value: 'My Brokerage' } })
    fireEvent.click(screen.getByText('Create Account & Continue'))

    // The import completes and the position shows up, instead of the CSV being discarded.
    await waitFor(() => expect(screen.getByText('AAPL')).toBeTruthy())
  })
})

describe('view switching (dashboard vs settings)', () => {
  beforeEach(async () => {
    await clearDatabase()
  })

  it('should render dashboard view by default with Nav and SummaryCards', async () => {
    render(<App />)

    // Wait for hydration
    await waitFor(() => {
      expect(screen.queryByText('Loading dashboard...')).toBeFalsy()
    })

    // Dashboard elements should be visible
    expect(screen.getByText('Positions')).toBeTruthy()
    expect(screen.getByText('Transactions')).toBeTruthy()
  })

  it('should switch to settings page when gear button is clicked', async () => {
    render(<App />)

    // Wait for hydration
    await waitFor(() => {
      expect(screen.queryByText('Loading dashboard...')).toBeFalsy()
    })

    // Dashboard should initially be visible
    expect(screen.getByText('Positions')).toBeTruthy()

    // Click the settings gear button (⚙️)
    const gearButton = screen.getByTitle('Settings')
    fireEvent.click(gearButton)

    // Settings page elements should now be visible
    await waitFor(() => {
      expect(screen.getByText('Google Drive Sync')).toBeTruthy()
    })

    // Dashboard elements should not be visible
    expect(screen.queryByText('Positions')).toBeFalsy()
    expect(screen.queryByText('Transactions')).toBeFalsy()
  })

  it('should return to dashboard when Back button is clicked from settings', async () => {
    render(<App />)

    // Wait for hydration
    await waitFor(() => {
      expect(screen.queryByText('Loading dashboard...')).toBeFalsy()
    })

    // Click the settings gear button
    const gearButton = screen.getByTitle('Settings')
    fireEvent.click(gearButton)

    // Wait for settings page to appear
    await waitFor(() => {
      expect(screen.getByText('Google Drive Sync')).toBeTruthy()
    })

    // Click the Back button
    const backButton = screen.getByText('Back to Dashboard')
    fireEvent.click(backButton)

    // Dashboard should be visible again
    await waitFor(() => {
      expect(screen.getByText('Positions')).toBeTruthy()
      expect(screen.getByText('Transactions')).toBeTruthy()
    })

    // Settings page should not be visible
    expect(screen.queryByText('Google Drive Sync')).toBeFalsy()
  })
})
