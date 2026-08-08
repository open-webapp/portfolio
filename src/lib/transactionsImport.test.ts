import { describe, it, expect } from 'vitest'
import { importTransactions, transactionNaturalKey } from './transactionsImport'
import { initialState } from './state'
import type { Transaction, Account } from './types'
import { uid } from './seed'

describe('transactionsImport', () => {
  // Helper to create a test account
  function createTestAccount(accountId: string, accountNumber: string): Account {
    return {
      id: accountId,
      accountNumber,
      name: `Account ${accountNumber}`,
      taxCategory: 'taxable',
      retirement: false,
      createdAt: new Date().toISOString(),
    }
  }

  // Helper to create a test transaction
  function createTestTransaction(
    accountId: string,
    date: string,
    symbol: string,
    type: string,
    shares: number,
    price: number,
    amount: number
  ): Transaction {
    return {
      id: uid('tx'),
      accountId,
      date,
      symbol,
      type,
      shares,
      price,
      amount,
      importedAt: new Date().toISOString(),
    }
  }

  // Test 1: Row matching existing transaction's natural key is skipped
  it('Row matching existing transaction natural key is skipped', () => {
    let state = initialState()

    const accountId = 'acc-001'
    const account = createTestAccount(accountId, 'ACC-001')
    state = { ...state, accounts: [account] }

    // Add an existing transaction
    const existingTx = createTestTransaction(accountId, '2024-01-15', 'AAPL', 'Buy', 10, 150.5, 1505)
    state = { ...state, transactions: [existingTx] }

    // Try to import a row with the same natural key
    const mappedRows = [
      {
        date: '2024-01-15',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '10',
        price: '150.5',
        amount: '1505',
      },
    ]

    const newState = importTransactions(state, accountId, mappedRows, 'import-dedup-skip')

    // Should still have only 1 transaction (duplicate skipped)
    expect(newState.transactions).toHaveLength(1)
    expect(newState.transactions[0].id).toBe(existingTx.id)
  })

  // Test 2: Row differing in any one natural-key field IS inserted as new
  it('Row differing in price field is inserted as new', () => {
    let state = initialState()

    const accountId = 'acc-002'
    const account = createTestAccount(accountId, 'ACC-002')
    state = { ...state, accounts: [account] }

    // Add an existing transaction
    const existingTx = createTestTransaction(accountId, '2024-01-15', 'AAPL', 'Buy', 10, 150.5, 1505)
    state = { ...state, transactions: [existingTx] }

    // Import row with same data but different price
    const mappedRows = [
      {
        date: '2024-01-15',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '10',
        price: '151.0', // Different price
        amount: '1510',
      },
    ]

    const newState = importTransactions(state, accountId, mappedRows, 'import-price-diff')

    // Should have 2 transactions now
    expect(newState.transactions).toHaveLength(2)

    // Original should still be there
    expect(newState.transactions[0].id).toBe(existingTx.id)

    // New one should be added
    const newTx = newState.transactions[1]
    expect(newTx.price).toBe(151.0)
    expect(newTx.accountId).toBe(accountId)
  })

  // Test 2b: Row differing in shares field is inserted as new
  it('Row differing in shares field is inserted as new', () => {
    let state = initialState()

    const accountId = 'acc-002b'
    const account = createTestAccount(accountId, 'ACC-002B')
    state = { ...state, accounts: [account] }

    const existingTx = createTestTransaction(accountId, '2024-01-15', 'GOOGL', 'Sell', 5, 120.0, 600)
    state = { ...state, transactions: [existingTx] }

    const mappedRows = [
      {
        date: '2024-01-15',
        symbol: 'GOOGL',
        type: 'Sell',
        shares: '6', // Different shares
        price: '120.0',
        amount: '720',
      },
    ]

    const newState = importTransactions(state, accountId, mappedRows, 'import-shares-diff')

    expect(newState.transactions).toHaveLength(2)
    expect(newState.transactions[1].shares).toBe(6)
  })

  // Test 2c: Row differing in type field is inserted as new
  it('Row differing in type field is inserted as new', () => {
    let state = initialState()

    const accountId = 'acc-002c'
    const account = createTestAccount(accountId, 'ACC-002C')
    state = { ...state, accounts: [account] }

    const existingTx = createTestTransaction(accountId, '2024-01-15', 'MSFT', 'Buy', 20, 300.0, 6000)
    state = { ...state, transactions: [existingTx] }

    const mappedRows = [
      {
        date: '2024-01-15',
        symbol: 'MSFT',
        type: 'Sell', // Different type
        shares: '20',
        price: '300.0',
        amount: '6000',
      },
    ]

    const newState = importTransactions(state, accountId, mappedRows, 'import-type-diff')

    expect(newState.transactions).toHaveLength(2)
    expect(newState.transactions[1].type).toBe('Sell')
  })

  // Test 2d: Row differing in symbol field is inserted as new
  it('Row differing in symbol field is inserted as new', () => {
    let state = initialState()

    const accountId = 'acc-002d'
    const account = createTestAccount(accountId, 'ACC-002D')
    state = { ...state, accounts: [account] }

    const existingTx = createTestTransaction(accountId, '2024-01-15', 'TSLA', 'Buy', 15, 200.0, 3000)
    state = { ...state, transactions: [existingTx] }

    const mappedRows = [
      {
        date: '2024-01-15',
        symbol: 'NVDA', // Different symbol
        type: 'Buy',
        shares: '15',
        price: '200.0',
        amount: '3000',
      },
    ]

    const newState = importTransactions(state, accountId, mappedRows, 'import-symbol-diff')

    expect(newState.transactions).toHaveLength(2)
    expect(newState.transactions[1].symbol).toBe('NVDA')
  })

  // Test 2e: Row differing in date field is inserted as new
  it('Row differing in date field is inserted as new', () => {
    let state = initialState()

    const accountId = 'acc-002e'
    const account = createTestAccount(accountId, 'ACC-002E')
    state = { ...state, accounts: [account] }

    const existingTx = createTestTransaction(accountId, '2024-01-15', 'META', 'Buy', 8, 250.0, 2000)
    state = { ...state, transactions: [existingTx] }

    const mappedRows = [
      {
        date: '2024-01-16', // Different date
        symbol: 'META',
        type: 'Buy',
        shares: '8',
        price: '250.0',
        amount: '2000',
      },
    ]

    const newState = importTransactions(state, accountId, mappedRows, 'import-date-diff')

    expect(newState.transactions).toHaveLength(2)
    expect(newState.transactions[1].date).toBe('2024-01-16')
  })

  // Test 3: Row for different account with identical natural-key fields is inserted (dedup per-account)
  it('Row for different account with identical natural-key fields is inserted', () => {
    let state = initialState()

    const accountId1 = 'acc-003a'
    const accountId2 = 'acc-003b'
    const account1 = createTestAccount(accountId1, 'ACC-003A')
    const account2 = createTestAccount(accountId2, 'ACC-003B')
    state = { ...state, accounts: [account1, account2] }

    // Add transaction to account 1
    const tx1 = createTestTransaction(accountId1, '2024-01-15', 'AAPL', 'Buy', 10, 150.5, 1505)
    state = { ...state, transactions: [tx1] }

    // Import same natural key for account 2 (should be inserted, not deduplicated)
    const mappedRows = [
      {
        date: '2024-01-15',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '10',
        price: '150.5',
        amount: '1505',
      },
    ]

    const newState = importTransactions(state, accountId2, mappedRows, 'import-diff-account')

    // Should have 2 transactions now (one per account)
    expect(newState.transactions).toHaveLength(2)

    // Both should exist but for different accounts
    const tx1Found = newState.transactions.find((t) => t.accountId === accountId1)
    const tx2Found = newState.transactions.find((t) => t.accountId === accountId2)

    expect(tx1Found).toBeDefined()
    expect(tx2Found).toBeDefined()
    expect(tx1Found?.id).toBe(tx1.id)
    expect(tx2Found?.id).not.toBe(tx1.id)
  })

  // Test 4: Importing empty CSV (zero rows) is a no-op
  it('Importing empty CSV is a no-op', () => {
    let state = initialState()

    const accountId = 'acc-004'
    const account = createTestAccount(accountId, 'ACC-004')
    state = { ...state, accounts: [account] }

    // Add an existing transaction
    const existingTx = createTestTransaction(accountId, '2024-01-15', 'AAPL', 'Buy', 10, 150.5, 1505)
    state = { ...state, transactions: [existingTx] }

    // Import empty rows
    const mappedRows: Record<string, string>[] = []

    const newState = importTransactions(state, accountId, mappedRows, 'import-empty')

    // Should still have only 1 transaction
    expect(newState.transactions).toHaveLength(1)
    expect(newState.transactions[0].id).toBe(existingTx.id)
  })

  // Test 5: Mixed batch (half duplicate, half new) — only new half inserted
  it('Mixed batch with duplicates and new transactions inserts only new', () => {
    let state = initialState()

    const accountId = 'acc-005'
    const account = createTestAccount(accountId, 'ACC-005')
    state = { ...state, accounts: [account] }

    // Add some existing transactions
    const tx1 = createTestTransaction(accountId, '2024-01-15', 'AAPL', 'Buy', 10, 150.5, 1505)
    const tx2 = createTestTransaction(accountId, '2024-01-20', 'GOOGL', 'Sell', 5, 120.0, 600)
    state = { ...state, transactions: [tx1, tx2] }

    // Import batch: 2 duplicates + 3 new
    const mappedRows = [
      {
        // Duplicate of tx1
        date: '2024-01-15',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '10',
        price: '150.5',
        amount: '1505',
      },
      {
        // New
        date: '2024-02-10',
        symbol: 'MSFT',
        type: 'Buy',
        shares: '15',
        price: '300.0',
        amount: '4500',
      },
      {
        // Duplicate of tx2
        date: '2024-01-20',
        symbol: 'GOOGL',
        type: 'Sell',
        shares: '5',
        price: '120.0',
        amount: '600',
      },
      {
        // New
        date: '2024-02-15',
        symbol: 'TSLA',
        type: 'Buy',
        shares: '20',
        price: '200.0',
        amount: '4000',
      },
      {
        // New
        date: '2024-02-20',
        symbol: 'NVDA',
        type: 'Buy',
        shares: '12',
        price: '450.0',
        amount: '5400',
      },
    ]

    const newState = importTransactions(state, accountId, mappedRows, 'import-mixed-batch')

    // Should have 5 transactions: 2 original + 3 new
    expect(newState.transactions).toHaveLength(5)

    // Original should still be there
    expect(newState.transactions.find((t) => t.id === tx1.id)).toBeDefined()
    expect(newState.transactions.find((t) => t.id === tx2.id)).toBeDefined()

    // New ones should have the expected symbols
    const newTxSymbols = newState.transactions
      .filter((t) => t.id !== tx1.id && t.id !== tx2.id)
      .map((t) => t.symbol)
      .sort()

    expect(newTxSymbols).toEqual(['MSFT', 'NVDA', 'TSLA'])
  })

  // Test: transactionNaturalKey function works correctly
  it('transactionNaturalKey computes correct key', () => {
    const row = {
      date: '2024-01-15',
      symbol: 'AAPL',
      type: 'Buy',
      shares: '10',
      price: '150.5',
      amount: '1505',
    }

    const key = transactionNaturalKey(row)

    // Note: numeric fields are parsed, so "150.5" becomes 150.5 (JavaScript will render as "150.5")
    expect(key).toBe('2024-01-15|AAPL|Buy|10|150.5')
  })

  // Test: transactionNaturalKey with empty fields
  it('transactionNaturalKey handles empty fields gracefully', () => {
    const row = {
      date: '',
      symbol: 'AAPL',
      type: 'Buy',
      shares: '10',
      price: '150.5',
      amount: '1505',
    }

    const key = transactionNaturalKey(row)

    // Empty string for date, numeric fields are parsed
    expect(key).toBe('|AAPL|Buy|10|150.5')
  })

  // Test: Multiple import operations accumulate correctly
  it('Multiple import operations accumulate correctly', () => {
    let state = initialState()

    const accountId = 'acc-multi'
    const account = createTestAccount(accountId, 'ACC-MULTI')
    state = { ...state, accounts: [account] }

    // First import: 2 transactions
    let mappedRows = [
      {
        date: '2024-01-10',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '10',
        price: '150.0',
        amount: '1500',
      },
      {
        date: '2024-01-15',
        symbol: 'GOOGL',
        type: 'Buy',
        shares: '5',
        price: '120.0',
        amount: '600',
      },
    ]

    state = importTransactions(state, accountId, mappedRows, 'import-multi-1')
    expect(state.transactions).toHaveLength(2)

    // Second import: 1 duplicate + 2 new
    mappedRows = [
      {
        date: '2024-01-10',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '10',
        price: '150.0',
        amount: '1500',
      }, // Duplicate
      {
        date: '2024-01-20',
        symbol: 'MSFT',
        type: 'Buy',
        shares: '8',
        price: '300.0',
        amount: '2400',
      }, // New
      {
        date: '2024-01-25',
        symbol: 'TSLA',
        type: 'Sell',
        shares: '3',
        price: '200.0',
        amount: '600',
      }, // New
    ]

    state = importTransactions(state, accountId, mappedRows, 'import-multi-2')
    expect(state.transactions).toHaveLength(4) // 2 original + 2 new

    // Third import: all duplicates
    mappedRows = [
      {
        date: '2024-01-10',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '10',
        price: '150.0',
        amount: '1500',
      },
      {
        date: '2024-01-15',
        symbol: 'GOOGL',
        type: 'Buy',
        shares: '5',
        price: '120.0',
        amount: '600',
      },
    ]

    state = importTransactions(state, accountId, mappedRows, 'import-multi-3')
    expect(state.transactions).toHaveLength(4) // No new transactions added
  })

  // Test: Numeric fields are parsed correctly
  it('Numeric fields are parsed correctly', () => {
    let state = initialState()

    const accountId = 'acc-numeric'
    const account = createTestAccount(accountId, 'ACC-NUMERIC')
    state = { ...state, accounts: [account] }

    const mappedRows = [
      {
        date: '2024-01-15',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '10.5',
        price: '150.75',
        amount: '1582.875',
      },
    ]

    const newState = importTransactions(state, accountId, mappedRows, 'import-numeric')

    expect(newState.transactions).toHaveLength(1)

    const tx = newState.transactions[0]
    expect(tx.shares).toBe(10.5)
    expect(tx.price).toBe(150.75)
    expect(tx.amount).toBe(1582.875)
  })

  // Test: Transaction ID is always unique
  it('Each imported transaction gets a unique ID', () => {
    let state = initialState()

    const accountId = 'acc-unique'
    const account = createTestAccount(accountId, 'ACC-UNIQUE')
    state = { ...state, accounts: [account] }

    const mappedRows = [
      {
        date: '2024-01-15',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '10',
        price: '150.0',
        amount: '1500',
      },
      {
        date: '2024-01-16',
        symbol: 'GOOGL',
        type: 'Buy',
        shares: '5',
        price: '120.0',
        amount: '600',
      },
    ]

    const newState = importTransactions(state, accountId, mappedRows, 'import-unique-id')

    const ids = newState.transactions.map((t) => t.id)
    const uniqueIds = new Set(ids)

    // All IDs should be unique
    expect(uniqueIds.size).toBe(ids.length)
    expect(uniqueIds.size).toBe(2)
  })

  // Test: importedAt is set to current timestamp
  it('Each imported transaction has importedAt timestamp', () => {
    let state = initialState()

    const accountId = 'acc-timestamp'
    const account = createTestAccount(accountId, 'ACC-TIMESTAMP')
    state = { ...state, accounts: [account] }

    const mappedRows = [
      {
        date: '2024-01-15',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '10',
        price: '150.0',
        amount: '1500',
      },
    ]

    const beforeImport = new Date().toISOString()
    const newState = importTransactions(state, accountId, mappedRows, 'import-timestamp')
    const afterImport = new Date().toISOString()

    const tx = newState.transactions[0]

    // importedAt should be a valid ISO string between beforeImport and afterImport
    expect(tx.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(new Date(tx.importedAt).getTime()).toBeGreaterThanOrEqual(new Date(beforeImport).getTime())
    expect(new Date(tx.importedAt).getTime()).toBeLessThanOrEqual(new Date(afterImport).getTime())
  })

  // Task 8: Test 1 - Import transaction with no taxes column mapped
  it('Task 8.1: Import transaction with no taxes column mapped', () => {
    let state = initialState()

    const accountId = 'acc-task8-1'
    const account = createTestAccount(accountId, 'ACC-TASK8-1')
    state = { ...state, accounts: [account] }

    // Import row without taxes (undefined)
    const mappedRows = [
      {
        date: '2024-01-15',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '10',
        price: '150.5',
        amount: '1505',
        // taxes is not provided
      },
    ]

    const newState = importTransactions(state, accountId, mappedRows, 'import-no-taxes')

    expect(newState.transactions).toHaveLength(1)
    const tx = newState.transactions[0]
    expect(tx.taxes).toBeNull()
  })

  // Task 8: Test 2 - Import transaction with taxes column mapped
  it('Task 8.2: Import transaction with taxes column mapped', () => {
    let state = initialState()

    const accountId = 'acc-task8-2'
    const account = createTestAccount(accountId, 'ACC-TASK8-2')
    state = { ...state, accounts: [account] }

    // Import row with taxes mapped
    const mappedRows = [
      {
        date: '2024-01-15',
        symbol: 'MSFT',
        type: 'Sell',
        shares: '5',
        price: '300.0',
        amount: '1500',
        taxes: '25.10',
      },
    ]

    const newState = importTransactions(state, accountId, mappedRows, 'import-with-taxes')

    expect(newState.transactions).toHaveLength(1)
    const tx = newState.transactions[0]
    expect(tx.taxes).toBe(25.10)
  })

  // Regression: a CSV row with blank cells for required fields (e.g. missing
  // shares/price/amount) used to still be imported, producing a Transaction
  // with NaN numeric fields instead of being skipped.
  it('skips rows with missing required fields instead of importing NaN transactions', () => {
    let state = initialState()

    const accountId = 'acc-blank-row'
    const account = createTestAccount(accountId, 'ACC-BLANK')
    state = { ...state, accounts: [account] }

    const mappedRows = [
      {
        date: '2024-01-15',
        symbol: 'MSFT',
        type: 'Sell',
        shares: '5',
        price: '300.0',
        amount: '1500',
      },
      {
        // Blank row: shares/price/amount cells were empty in the CSV
        date: '2024-01-16',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '',
        price: '',
        amount: '',
      },
    ]

    const newState = importTransactions(state, accountId, mappedRows, 'import-skip-blank')

    expect(newState.transactions).toHaveLength(1)
    expect(newState.transactions[0].symbol).toBe('MSFT')
    expect(newState.transactions.some((t) => Number.isNaN(t.shares))).toBe(false)
  })

  // Task 6: Test 1 - New transaction rows get importSessionId equal to the value passed in
  it('Task 6.1: New transaction rows get importSessionId equal to the value passed in', () => {
    let state = initialState()

    const accountId = 'acc-task6-1'
    const account = createTestAccount(accountId, 'ACC-TASK6-1')
    state = { ...state, accounts: [account] }

    const sessionId = 'session-abc-123'
    const mappedRows = [
      {
        date: '2024-01-15',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '10',
        price: '150.0',
        amount: '1500',
      },
      {
        date: '2024-01-20',
        symbol: 'GOOGL',
        type: 'Buy',
        shares: '5',
        price: '120.0',
        amount: '600',
      },
    ]

    const newState = importTransactions(state, accountId, mappedRows, sessionId)

    expect(newState.transactions).toHaveLength(2)
    expect(newState.transactions[0].importSessionId).toBe(sessionId)
    expect(newState.transactions[1].importSessionId).toBe(sessionId)
  })

  // Task 6: Test 2 - Deduped (skipped) rows don't produce a phantom session-tagged row
  it('Task 6.2: Deduped (skipped) rows do not produce a phantom session-tagged row', () => {
    let state = initialState()

    const accountId = 'acc-task6-2'
    const account = createTestAccount(accountId, 'ACC-TASK6-2')
    state = { ...state, accounts: [account] }

    // Add an existing transaction with a specific session id
    const existingTx = createTestTransaction(accountId, '2024-01-15', 'AAPL', 'Buy', 10, 150.0, 1500)
    existingTx.importSessionId = 'session-old-001'
    state = { ...state, transactions: [existingTx] }

    // Try to import a row with the same natural key but different session id
    const mappedRows = [
      {
        date: '2024-01-15',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '10',
        price: '150.0',
        amount: '1500',
      },
    ]

    const newSessionId = 'session-new-002'
    const newState = importTransactions(state, accountId, mappedRows, newSessionId)

    // Should still have only 1 transaction (duplicate skipped)
    expect(newState.transactions).toHaveLength(1)

    // The existing transaction's session id should NOT be overwritten
    expect(newState.transactions[0].importSessionId).toBe('session-old-001')
  })

  // Task 6: Test 3 - Two sequential imports with different session ids
  it('Task 6.3: Two sequential imports with different session ids preserve session ids correctly', () => {
    let state = initialState()

    const accountId = 'acc-task6-3'
    const account = createTestAccount(accountId, 'ACC-TASK6-3')
    state = { ...state, accounts: [account] }

    // First import with session id 1
    const sessionId1 = 'session-import-1'
    const mappedRows1 = [
      {
        date: '2024-01-15',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '10',
        price: '150.0',
        amount: '1500',
      },
      {
        date: '2024-01-20',
        symbol: 'GOOGL',
        type: 'Buy',
        shares: '5',
        price: '120.0',
        amount: '600',
      },
    ]

    state = importTransactions(state, accountId, mappedRows1, sessionId1)
    expect(state.transactions).toHaveLength(2)

    // Verify first import's transactions have session id 1
    const txFromImport1 = state.transactions.filter((t) => t.symbol === 'AAPL' || t.symbol === 'GOOGL')
    expect(txFromImport1.every((t) => t.importSessionId === sessionId1)).toBe(true)

    // Second import with session id 2 (includes one duplicate + one new)
    const sessionId2 = 'session-import-2'
    const mappedRows2 = [
      {
        date: '2024-01-15',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '10',
        price: '150.0',
        amount: '1500',
      }, // Duplicate from import 1
      {
        date: '2024-02-10',
        symbol: 'MSFT',
        type: 'Buy',
        shares: '8',
        price: '300.0',
        amount: '2400',
      }, // New
    ]

    state = importTransactions(state, accountId, mappedRows2, sessionId2)
    expect(state.transactions).toHaveLength(3)

    // Verify pre-existing transactions from import 1 still have session id 1
    const aaplTx = state.transactions.find((t) => t.symbol === 'AAPL')
    const googlTx = state.transactions.find((t) => t.symbol === 'GOOGL')
    expect(aaplTx?.importSessionId).toBe(sessionId1)
    expect(googlTx?.importSessionId).toBe(sessionId1)

    // Verify new transaction from import 2 has session id 2
    const msftTx = state.transactions.find((t) => t.symbol === 'MSFT')
    expect(msftTx?.importSessionId).toBe(sessionId2)
  })
})
