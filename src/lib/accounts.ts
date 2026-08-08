import type { Account, MappingProfile, TaxCategory } from './types'
import type { AppState } from './state'
import { uid } from './seed'

/**
 * Resolve an account number from a CSV row using the mapping profile.
 * If accountNumberColumn is not set in the profile, returns null.
 * Otherwise, reads the value from the row using the accountNumberColumn key.
 */
export function resolveAccountNumber(
  row: Record<string, string>,
  profile: MappingProfile
): string | null {
  if (!profile.accountNumberColumn) {
    return null
  }

  const accountNumber = row[profile.accountNumberColumn]
  return accountNumber ?? null
}

/**
 * Check if an account number exists in state.accounts, or signal that it needs user input.
 * Returns the existing Account if found, or the string 'needs-prompt' if it's the first time
 * seeing this account number (first-seen detection).
 */
export function findOrCreateAccountPrompt(
  state: AppState,
  accountNumber: string
): Account | 'needs-prompt' {
  const existing = state.accounts.find((a) => a.accountNumber === accountNumber)

  if (existing) {
    return existing
  }

  // First-seen: signal that user input is needed
  return 'needs-prompt'
}

/**
 * Create a new Account with prompted values and add it to the state.
 * Returns the updated AppState with the new account added to state.accounts.
 */
export function finalizeNewAccount(
  state: AppState,
  accountNumber: string,
  name: string,
  taxCategory: TaxCategory,
  retirement: boolean
): AppState {
  const newAccount: Account = {
    id: uid('acc'),
    accountNumber,
    name,
    taxCategory,
    retirement,
    createdAt: new Date().toISOString(),
  }

  return {
    ...state,
    accounts: [...state.accounts, newAccount],
  }
}
