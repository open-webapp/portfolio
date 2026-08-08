import { describe, it, expect } from 'vitest'
import {
  resolveAccountNumber,
  findOrCreateAccountPrompt,
  finalizeNewAccount,
} from './accounts'
import type { MappingProfile, Account } from './types'
import { initialState } from './state'

describe('accounts', () => {
  // Test 1: resolveAccountNumber returns mapped value when accountNumberColumn is set
  it('resolveAccountNumber returns mapped value when accountNumberColumn is set', () => {
    const profile: MappingProfile = {
      id: 'map-test1',
      name: 'Test Profile',
      kind: 'positions',
      fieldMap: { Symbol: 'symbol' },
      accountNumberColumn: 'AccountID',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const row = {
      AccountID: 'ACC-12345',
      Symbol: 'AAPL',
      Name: 'Apple Inc.',
    }

    const result = resolveAccountNumber(row, profile)

    expect(result).toBe('ACC-12345')
  })

  // Test 2: resolveAccountNumber returns null when accountNumberColumn is unset
  it('resolveAccountNumber returns null when accountNumberColumn is unset', () => {
    const profile: MappingProfile = {
      id: 'map-test2',
      name: 'Test Profile',
      kind: 'positions',
      fieldMap: { Symbol: 'symbol' },
      // accountNumberColumn is undefined
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const row = {
      Symbol: 'GOOGL',
      Name: 'Alphabet Inc.',
    }

    const result = resolveAccountNumber(row, profile)

    expect(result).toBeNull()
  })

  // Test 3: First-seen account (not in state.accounts) triggers 'needs-prompt'
  it('First-seen account (not in state.accounts) triggers needs-prompt', () => {
    const state = initialState()

    const result = findOrCreateAccountPrompt(state, 'ACC-NEW-999')

    expect(result).toBe('needs-prompt')
  })

  // Test 4: finalizeNewAccount creates Account with prompted values and it's found on next resolve
  it('finalizeNewAccount creates Account with prompted values and it\'s found on next resolve', () => {
    const state = initialState()

    const updatedState = finalizeNewAccount(
      state,
      'ACC-NEW-001',
      'My Brokerage Account',
      'taxable',
      false
    )

    // Verify account was added
    expect(updatedState.accounts).toHaveLength(1)

    const newAccount = updatedState.accounts[0]
    expect(newAccount).toBeDefined()
    expect(newAccount.accountNumber).toBe('ACC-NEW-001')
    expect(newAccount.name).toBe('My Brokerage Account')
    expect(newAccount.taxCategory).toBe('taxable')
    expect(newAccount.retirement).toBe(false)
    expect(newAccount.id).toMatch(/^acc-/) // should start with 'acc-' prefix
    expect(newAccount.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/) // ISO date format

    // Now verify that findOrCreateAccountPrompt finds it
    const found = findOrCreateAccountPrompt(updatedState, 'ACC-NEW-001')
    expect(found).not.toBe('needs-prompt')
    expect((found as Account).accountNumber).toBe('ACC-NEW-001')
    expect((found as Account).name).toBe('My Brokerage Account')
  })

  // Test 5: Existing account (already in state.accounts) resolves directly without prompt
  it('Existing account (already in state.accounts) resolves directly without prompt', () => {
    const state = initialState()

    // Create an account first
    const stateWithAccount = finalizeNewAccount(
      state,
      'ACC-EXISTING',
      'Existing Account',
      'nonTaxable',
      true
    )

    // Try to find it
    const result = findOrCreateAccountPrompt(stateWithAccount, 'ACC-EXISTING')

    expect(result).not.toBe('needs-prompt')
    expect((result as Account).accountNumber).toBe('ACC-EXISTING')
    expect((result as Account).name).toBe('Existing Account')
    expect((result as Account).taxCategory).toBe('nonTaxable')
    expect((result as Account).retirement).toBe(true)
  })

  // Additional test: resolveAccountNumber with missing column in row returns null
  it('resolveAccountNumber with missing column in row returns null', () => {
    const profile: MappingProfile = {
      id: 'map-test3',
      name: 'Test Profile',
      kind: 'positions',
      fieldMap: { Symbol: 'symbol' },
      accountNumberColumn: 'AccountID', // Column exists in profile
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const row = {
      // AccountID is missing from row
      Symbol: 'MSFT',
      Name: 'Microsoft',
    }

    const result = resolveAccountNumber(row, profile)

    expect(result).toBeNull()
  })

  // Additional test: Multiple accounts can be created and found
  it('Multiple accounts can be created and found', () => {
    let state = initialState()

    // Create first account
    state = finalizeNewAccount(state, 'ACC-001', 'Account One', 'taxable', false)

    // Create second account
    state = finalizeNewAccount(state, 'ACC-002', 'Account Two', 'taxDeferred', true)

    // Create third account
    state = finalizeNewAccount(state, 'ACC-003', 'Account Three', 'nonTaxable', true)

    expect(state.accounts).toHaveLength(3)

    // Each account should be findable
    const acc1 = findOrCreateAccountPrompt(state, 'ACC-001')
    const acc2 = findOrCreateAccountPrompt(state, 'ACC-002')
    const acc3 = findOrCreateAccountPrompt(state, 'ACC-003')

    expect((acc1 as Account).name).toBe('Account One')
    expect((acc2 as Account).name).toBe('Account Two')
    expect((acc3 as Account).name).toBe('Account Three')

    // A non-existent account should still trigger needs-prompt
    const accNotFound = findOrCreateAccountPrompt(state, 'ACC-999')
    expect(accNotFound).toBe('needs-prompt')
  })

  // Additional test: resolveAccountNumber with all tax categories
  it('finalizeNewAccount works with all tax categories', () => {
    let state = initialState()

    const taxableState = finalizeNewAccount(state, 'ACC-TAXABLE', 'Taxable', 'taxable', false)
    const nonTaxableState = finalizeNewAccount(
      taxableState,
      'ACC-NONTAXABLE',
      'Non-Taxable',
      'nonTaxable',
      false
    )
    const taxDeferredState = finalizeNewAccount(
      nonTaxableState,
      'ACC-TAXDEFERRED',
      'Tax-Deferred',
      'taxDeferred',
      true
    )

    expect(taxDeferredState.accounts).toHaveLength(3)

    const found1 = findOrCreateAccountPrompt(taxDeferredState, 'ACC-TAXABLE')
    const found2 = findOrCreateAccountPrompt(taxDeferredState, 'ACC-NONTAXABLE')
    const found3 = findOrCreateAccountPrompt(taxDeferredState, 'ACC-TAXDEFERRED')

    expect((found1 as Account).taxCategory).toBe('taxable')
    expect((found2 as Account).taxCategory).toBe('nonTaxable')
    expect((found3 as Account).taxCategory).toBe('taxDeferred')
  })

  // Additional test: finalizeNewAccount doesn't modify original state
  it('finalizeNewAccount does not modify original state', () => {
    const state = initialState()

    const updatedState = finalizeNewAccount(
      state,
      'ACC-NEW',
      'New Account',
      'taxable',
      false
    )

    // Original state should still be empty
    expect(state.accounts).toHaveLength(0)

    // Updated state should have the new account
    expect(updatedState.accounts).toHaveLength(1)
  })

  // Additional test: resolveAccountNumber with empty string accountNumberColumn
  it('resolveAccountNumber with empty string in accountNumberColumn returns null', () => {
    const profile: MappingProfile = {
      id: 'map-test4',
      name: 'Test Profile',
      kind: 'positions',
      fieldMap: { Symbol: 'symbol' },
      accountNumberColumn: 'AccountID',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const row = {
      AccountID: '', // Empty string
      Symbol: 'AAPL',
    }

    const result = resolveAccountNumber(row, profile)

    // Empty string is still a value in the row, so it returns it
    expect(result).toBe('')
  })
})
