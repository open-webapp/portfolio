import type { BudgetAccountRule, StatementConvention } from './types'

export interface BudgetAccountRow {
  accountName?: string
  amount: number
}

export interface BudgetAccountViewRow {
  accountName: string
  transactionCount: number
  statementConvention: StatementConvention
}

export interface BudgetAccountReconciliation<T extends BudgetAccountRow> {
  transactions: T[]
  markers: Record<string, StatementConvention>
}

const DEFAULT_STATEMENT_CONVENTION: StatementConvention = 'negativeSpend'

export function normalizeBudgetAccountName(accountName: string | undefined): string {
  return accountName?.trim().toLowerCase() ?? ''
}

export function activeBudgetAccountRule(
  rules: BudgetAccountRule[],
  accountName: string | undefined,
): BudgetAccountRule | undefined {
  const normalizedName = normalizeBudgetAccountName(accountName)
  if (!normalizedName) return undefined

  return rules.find((rule) => !rule.deletedAt && rule.normalizedName === normalizedName)
}

export function canonicalBudgetAccountName(
  rules: BudgetAccountRule[],
  accountName: string | undefined,
): string | undefined {
  return activeBudgetAccountRule(rules, accountName)?.displayName.trim()
}

export function defaultBudgetAccountConvention(): StatementConvention {
  return DEFAULT_STATEMENT_CONVENTION
}

export function desiredBudgetAccountConvention(
  rules: BudgetAccountRule[],
  accountName: string | undefined,
): StatementConvention {
  return activeBudgetAccountRule(rules, accountName)?.statementConvention ?? DEFAULT_STATEMENT_CONVENTION
}

export function convertBudgetAccountImportRows<T extends BudgetAccountRow>(
  rows: T[],
  rules: BudgetAccountRule[],
): T[] {
  let changed = false
  const converted = rows.map((row) => {
    const canonicalName = canonicalBudgetAccountName(rules, row.accountName)
    const shouldNegate = desiredBudgetAccountConvention(rules, row.accountName) === 'positiveSpend'
      && Number.isFinite(row.amount)
      && row.amount > 0

    const shouldCanonicalize = Boolean(canonicalName && canonicalName !== row.accountName)
    if (!shouldCanonicalize && !shouldNegate) return row
    changed = true
    return {
      ...row,
      ...(shouldCanonicalize ? { accountName: canonicalName } : {}),
      ...(shouldNegate ? { amount: -row.amount } : {}),
    }
  })

  return changed ? converted : rows
}

export function budgetAccountViewRows<T extends Pick<BudgetAccountRow, 'accountName'>>(
  rules: BudgetAccountRule[],
  transactions: T[],
): BudgetAccountViewRow[] {
  const accounts = new Map<string, { accountName: string; transactionCount: number }>()

  for (const rule of rules) {
    if (rule.deletedAt) continue
    const normalizedName = rule.normalizedName
    if (!normalizedName) continue
    accounts.set(normalizedName, { accountName: rule.displayName.trim(), transactionCount: 0 })
  }

  for (const transaction of transactions) {
    const normalizedName = normalizeBudgetAccountName(transaction.accountName)
    if (!normalizedName) continue
    const existing = accounts.get(normalizedName)
    if (existing) {
      existing.transactionCount += 1
    } else {
      accounts.set(normalizedName, { accountName: transaction.accountName!.trim(), transactionCount: 1 })
    }
  }

  return [...accounts.entries()]
    .map(([normalizedName, account]) => ({
      ...account,
      statementConvention: desiredBudgetAccountConvention(rules, normalizedName),
    }))
    .sort((a, b) => a.accountName.localeCompare(b.accountName))
}

export function reconcileBudgetAccountRules<T extends BudgetAccountRow>(
  transactions: T[],
  rules: BudgetAccountRule[],
  markers: Record<string, StatementConvention>,
): BudgetAccountReconciliation<T> {
  let transactionsChanged = false
  let markersChanged = false
  const nextMarkers = { ...markers }
  const nextTransactions = transactions.map((transaction) => {
    const normalizedName = normalizeBudgetAccountName(transaction.accountName)
    if (!normalizedName) return transaction

    const rule = activeBudgetAccountRule(rules, transaction.accountName)
    const oldConvention = markers[normalizedName] ?? DEFAULT_STATEMENT_CONVENTION
    const desiredConvention = rule?.statementConvention ?? DEFAULT_STATEMENT_CONVENTION
    const isAssigned = Boolean(rule) || normalizedName in markers
    if (!isAssigned) return transaction

    const canonicalName = rule?.displayName.trim()
    const shouldNegate = oldConvention !== desiredConvention && Number.isFinite(transaction.amount)
    const shouldCanonicalize = Boolean(canonicalName && canonicalName !== transaction.accountName)
    if (shouldNegate || shouldCanonicalize) {
      transactionsChanged = true
    }
    if (oldConvention !== desiredConvention) {
      nextMarkers[normalizedName] = desiredConvention
      markersChanged = true
    }

    if (!shouldNegate && !shouldCanonicalize) return transaction
    return {
      ...transaction,
      ...(shouldCanonicalize ? { accountName: canonicalName } : {}),
      ...(shouldNegate ? { amount: -transaction.amount } : {}),
    }
  })

  return {
    transactions: transactionsChanged ? nextTransactions : transactions,
    markers: markersChanged ? nextMarkers : markers,
  }
}
