import type { BudgetTransaction, StatementConvention } from '../lib/types'
import type { CategoryAction, GlobalCategoryState } from '../lib/categoryStore'
import { configureBudgetAccountRule, deleteBudgetAccountRule } from '../lib/categoryStore'
import { budgetAccountViewRows, defaultBudgetAccountConvention, normalizeBudgetAccountName } from '../lib/budgetAccountRules'

export interface BudgetAccountsTabProps {
  transactions: BudgetTransaction[]
  budgetAccountRules: GlobalCategoryState['budgetAccountRules']
  hydrated: boolean
  dispatch: (action: CategoryAction) => void
  onReconcile: (rules: GlobalCategoryState['budgetAccountRules']) => void
}

const conventions: { value: StatementConvention; label: string }[] = [
  { value: 'negativeSpend', label: 'Statement negative = spend' },
  { value: 'positiveSpend', label: 'Statement positive = spend' },
]

export function BudgetAccountsTab({ transactions, budgetAccountRules, hydrated, dispatch, onReconcile }: BudgetAccountsTabProps) {
  if (!hydrated) return <section className="card blueprint elev-sm">Loading budget accounts...</section>

  const rows = budgetAccountViewRows(budgetAccountRules, transactions)
  const configure = (accountName: string, convention: StatementConvention, transactionCount: number) => {
    const current = budgetAccountRules.find(
      (rule) => !rule.deletedAt && rule.normalizedName === normalizeBudgetAccountName(accountName),
    )?.statementConvention ?? defaultBudgetAccountConvention()
    if (current === convention) return
    if (!window.confirm(`Change statement convention for "${accountName}"? ${transactionCount} local transaction${transactionCount === 1 ? '' : 's'} will reconcile now; this change may affect other portfolios when they are opened.`)) return

    const nextRules = configureBudgetAccountRule(
      { categories: [], budgetAccountRules },
      accountName,
      convention,
    ).budgetAccountRules
    dispatch({ type: 'CONFIGURE_BUDGET_ACCOUNT_RULE', name: accountName, convention })
    onReconcile(nextRules)
  }

  const remove = (accountName: string) => {
    const normalizedName = normalizeBudgetAccountName(accountName)
    if (!window.confirm(`Remove the account rule for "${accountName}"? This can change its statement convention for future imports and other portfolios when they are opened.`)) return

    const nextRules = deleteBudgetAccountRule(
      { categories: [], budgetAccountRules },
      normalizedName,
    ).budgetAccountRules
    dispatch({ type: 'DELETE_BUDGET_ACCOUNT_RULE', normalizedName })
    onReconcile(nextRules)
  }

  return (
    <section className="card blueprint elev-sm">
      <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>Accounts</div>
      {rows.length === 0 ? (
        <div className="text-muted">Import statement transactions to configure account sign rules.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {rows.map((row) => {
            const hasRule = budgetAccountRules.some(
              (rule) => !rule.deletedAt && rule.normalizedName === normalizeBudgetAccountName(row.accountName),
            )
            return (
              <div key={row.accountName} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div style={{ minWidth: '160px' }}>
                  <div style={{ fontWeight: 600 }}>{row.accountName}</div>
                  <div className="text-muted" style={{ fontSize: '12px' }}>
                    {row.transactionCount} local transaction{row.transactionCount === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="seg" aria-label={`Statement convention for ${row.accountName}`}>
                  {conventions.map((convention) => (
                    <label key={convention.value} className="seg-opt">
                      <input
                        type="radio"
                        name={`budgetAccountConvention-${normalizeBudgetAccountName(row.accountName)}`}
                        checked={row.statementConvention === convention.value}
                        onChange={() => configure(row.accountName, convention.value, row.transactionCount)}
                      />
                      <span>{convention.label}</span>
                    </label>
                  ))}
                </div>
                <span className="text-muted" style={{ fontSize: '12px' }}>
                  Canonical amount: {row.statementConvention === 'negativeSpend' ? 'negative = spend' : 'positive = spend'}
                </span>
                {hasRule && row.transactionCount === 0 && (
                  <button type="button" className="btn btn-secondary" onClick={() => remove(row.accountName)}>
                    Remove rule
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
