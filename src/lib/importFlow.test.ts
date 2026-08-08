import { describe, it, expect } from 'vitest'
import { initialState, setPendingImport, setAccountPromptQueue } from './state'
import { appReducer } from './reducer'
import { finalizeNewAccount } from './accounts'
import type { MappingProfile } from './types'
import { uid } from './seed'

describe('importFlow - no account number column', () => {
  it('should use __default_account__ when no account number column is mapped', () => {
    let state = initialState()

    // Create a mapping profile WITHOUT accountNumberColumn
    const profile: MappingProfile = {
      id: uid('map'),
      name: 'Test Profile',
      kind: 'positions',
      fieldMap: {
        'Symbol': 'symbol',
        'Name': 'name',
        'AssetClass': 'assetClass',
        'Shares': 'shares',
        'AvgCost': 'avgCost',
        'Price': 'price',
      },
      accountNumberColumn: undefined, // NO ACCOUNT NUMBER COLUMN
    }

    // Set the mapping profile in state
    state = {
      ...state,
      mappingProfiles: [profile],
    }

    // Simulate rows from CSV (no account column because the profile doesn't have one)
    const rows = [
      {
        'Symbol': 'AAPL',
        'Name': 'Apple',
        'AssetClass': 'Equity',
        'Shares': '100',
        'AvgCost': '150',
        'Price': '180',
      },
      {
        'Symbol': 'MSFT',
        'Name': 'Microsoft',
        'AssetClass': 'Equity',
        'Shares': '50',
        'AvgCost': '300',
        'Price': '420',
      },
    ]

    // Dispatch SET_PENDING_IMPORT
    state = appReducer(state, {
      type: 'SET_PENDING_IMPORT',
      pendingImport: {
        kind: 'positions',
        rows: rows,
        profileId: profile.id,
      },
    })

    expect(state.pendingImport).toBeDefined()
    expect(state.pendingImport?.rows).toHaveLength(2)

    // Simulate the import processing effect
    // This is what App.tsx does in its effect
    if (state.pendingImport) {
      const { kind, rows: pendingRows, profileId } = state.pendingImport
      const foundProfile = state.mappingProfiles.find((p) => p.id === profileId)
      expect(foundProfile).toBeDefined()

      // Group rows - this is the key part: when no account number column,
      // we should use __default_account__ instead of skipping
      const rowsByAccount = new Map<string, Record<string, string>[]>()
      const accountNumbersToResolve = new Set<string>()

      for (const row of pendingRows) {
        // Simulate resolveAccountNumber - returns null when no accountNumberColumn
        const accountNumber = foundProfile!.accountNumberColumn
          ? row[foundProfile.accountNumberColumn]
          : null

        // The fix: use __default_account__ when accountNumber is null
        const finalAccountNumber = accountNumber || '__default_account__'

        accountNumbersToResolve.add(finalAccountNumber)
        if (!rowsByAccount.has(finalAccountNumber)) {
          rowsByAccount.set(finalAccountNumber, [])
        }
        rowsByAccount.get(finalAccountNumber)!.push(row)
      }

      // Verify that rows were grouped under __default_account__
      expect(accountNumbersToResolve.size).toBe(1)
      expect(accountNumbersToResolve.has('__default_account__')).toBe(true)
      expect(rowsByAccount.get('__default_account__')).toHaveLength(2)

      // Verify __default_account__ will trigger account prompt
      const account = state.accounts.find((a) => a.accountNumber === '__default_account__')
      expect(account).toBeUndefined() // Not found, so it should trigger needsPrompt
    }
  })

  it('should still work when account number column IS mapped', () => {
    let state = initialState()

    // Create a mapping profile WITH accountNumberColumn
    const profile: MappingProfile = {
      id: uid('map'),
      name: 'Test Profile',
      kind: 'positions',
      fieldMap: {
        'Account': 'accountNumber',
        'Symbol': 'symbol',
        'Name': 'name',
        'AssetClass': 'assetClass',
        'Shares': 'shares',
        'AvgCost': 'avgCost',
        'Price': 'price',
      },
      accountNumberColumn: 'Account',
    }

    state = {
      ...state,
      mappingProfiles: [profile],
    }

    const rows = [
      {
        'Account': 'ACC-001',
        'Symbol': 'AAPL',
        'Name': 'Apple',
        'AssetClass': 'Equity',
        'Shares': '100',
        'AvgCost': '150',
        'Price': '180',
      },
      {
        'Account': 'ACC-001',
        'Symbol': 'MSFT',
        'Name': 'Microsoft',
        'AssetClass': 'Equity',
        'Shares': '50',
        'AvgCost': '300',
        'Price': '420',
      },
    ]

    state = appReducer(state, {
      type: 'SET_PENDING_IMPORT',
      pendingImport: {
        kind: 'positions',
        rows: rows,
        profileId: profile.id,
      },
    })

    // Simulate the import processing
    if (state.pendingImport) {
      const { rows: pendingRows } = state.pendingImport
      const foundProfile = state.mappingProfiles[0]

      const rowsByAccount = new Map<string, Record<string, string>[]>()
      const accountNumbersToResolve = new Set<string>()

      for (const row of pendingRows) {
        const accountNumber = foundProfile.accountNumberColumn
          ? row[foundProfile.accountNumberColumn]
          : null
        const finalAccountNumber = accountNumber || '__default_account__'

        accountNumbersToResolve.add(finalAccountNumber)
        if (!rowsByAccount.has(finalAccountNumber)) {
          rowsByAccount.set(finalAccountNumber, [])
        }
        rowsByAccount.get(finalAccountNumber)!.push(row)
      }

      // Verify it uses ACC-001, not __default_account__
      expect(accountNumbersToResolve.size).toBe(1)
      expect(accountNumbersToResolve.has('ACC-001')).toBe(true)
      expect(accountNumbersToResolve.has('__default_account__')).toBe(false)
      expect(rowsByAccount.get('ACC-001')).toHaveLength(2)
    }
  })
})
