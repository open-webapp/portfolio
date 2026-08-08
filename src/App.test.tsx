import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { initialState } from './lib/state'
import { appReducer } from './lib/reducer'
import { importPositions } from './lib/positionsImport'
import { importTransactions } from './lib/transactionsImport'
import { savePersistedApp } from './lib/persist'
import type { MappingProfile } from './lib/types'
import App from './App'

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
    state = importPositions(state, 'acc-1', mappedRows, '2024-01-15')

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
    state = importTransactions(state, 'acc-1', mappedRows)

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
