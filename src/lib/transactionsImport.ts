import type { Transaction } from './types'
import type { AppState } from './state'
import { uid } from './seed'

/**
 * Compute a natural key for a transaction based on immutable fields.
 * Format: `${date}|${symbol}|${type}|${shares}|${price}`
 *
 * This key allows deduplication of transaction imports — if a row has the
 * same key as an existing transaction in the account, it's a duplicate and
 * will be skipped.
 *
 * For consistency, numeric values (shares and price) are normalized by parsing
 * and re-stringifying to ensure "150.0" and "150" map to the same key.
 */
export function transactionNaturalKey(row: Record<string, string>): string {
  const date = row.date || ''
  const symbol = row.symbol || ''
  const type = row.type || ''
  const shares = parseFloat(row.shares || '0')
  const price = parseFloat(row.price || '0')

  return `${date}|${symbol}|${type}|${shares}|${price}`
}

/**
 * Import transactions for an account with deduplication by natural key.
 *
 * (a) Compute natural key for each existing transaction in the account
 * (b) For each mapped row, compute its natural key
 * (c) Skip any row whose key matches an existing transaction
 * (d) Insert remaining rows as new Transaction entries with fresh uid('tx')
 * (e) Return updated state with new transactions
 *
 * Deduplication is per-account (same key in different accounts = inserted for each).
 */
export function importTransactions(
  state: AppState,
  accountId: string,
  mappedRows: Record<string, string>[]
): AppState {
  // Get existing transactions for this account
  const existingTransactions = state.transactions.filter((t) => t.accountId === accountId)

  // Compute set of existing natural keys for this account
  // Use parseFloat to normalize "150.0" and "150" to the same key representation
  const existingKeys = new Set(
    existingTransactions.map((t) => {
      return `${t.date}|${t.symbol}|${t.type}|${t.shares}|${t.price}`
    })
  )

  // Create new transactions from mapped rows, skipping duplicates
  const newTransactions: Transaction[] = []

  for (const row of mappedRows) {
    const rowKey = transactionNaturalKey(row)

    // Skip if this key already exists for this account
    if (existingKeys.has(rowKey)) {
      continue
    }

    // Parse numeric fields
    const shares = parseFloat(row.shares)
    const price = parseFloat(row.price)
    const amount = parseFloat(row.amount)

    // Create new transaction with fresh UID
    const newTransaction: Transaction = {
      id: uid('tx'),
      accountId,
      date: row.date,
      symbol: row.symbol,
      type: row.type,
      shares,
      price,
      amount,
      importedAt: new Date().toISOString(),
    }

    newTransactions.push(newTransaction)
  }

  // Add new transactions to state
  return {
    ...state,
    transactions: [...state.transactions, ...newTransactions],
  }
}
