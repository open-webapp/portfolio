import { useState, type CSSProperties } from 'react'
import type { AppState } from '../lib/state'
import { fmtUSD, toPeriod, GAIN_COLOR, LOSS_COLOR } from '../lib/computations'
import { visibleExpenses, categoryBreakdown } from '../lib/selectors'

export interface BudgetPageProps {
  state: AppState
  dispatch: (action: any) => void
}

const textBtnAccent: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: 'var(--color-accent)',
  fontSize: '12px',
  fontWeight: 600,
  padding: 0,
}

const textBtnDanger: CSSProperties = { ...textBtnAccent, color: LOSS_COLOR }

/**
 * Budget page: Monthly/Yearly period toggle, income/expense/net summary
 * cards, an income editor, an add-expense form, filter/sort controls, and
 * the expense table (inline edit/delete). Category management is added by
 * a later task extending this same component.
 */
export function BudgetPage({ state, dispatch }: BudgetPageProps) {
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const [filterCategory, setFilterCategory] = useState('__all')
  const [sortBy, setSortBy] = useState<'category' | 'name' | 'amount'>('category')
  const [formName, setFormName] = useState('')
  const [formCategory, setFormCategory] = useState(state.budgetCategories[0])
  const [formAmount, setFormAmount] = useState('')
  const [formFrequency, setFormFrequency] = useState<'monthly' | 'yearly'>('monthly')
  const [editingId, setEditingId] = useState<string | null>(null)

  const totalIncome =
    period === 'monthly'
      ? state.budgetIncomeMonthly + state.budgetIncomeYearly / 12
      : state.budgetIncomeMonthly * 12 + state.budgetIncomeYearly

  const totalExpense = state.budgetExpenses.reduce(
    (sum, e) => sum + toPeriod(e.amount, e.frequency, period),
    0
  )

  const net = totalIncome - totalExpense

  const rows = visibleExpenses(state.budgetExpenses, filterCategory, sortBy, period)
  const breakdown = categoryBreakdown(state.budgetExpenses, period)
  const unusedCategories = state.budgetCategories.filter(
    (cat) => !breakdown.some((b) => b.name === cat)
  )
  const breakdownRows =
    breakdown.length === 0
      ? []
      : [...breakdown, ...unusedCategories.map((name) => ({ name, amount: 0, pct: 0 }))]

  const handleDeleteCategory = (name: string) => {
    const count = state.budgetExpenses.filter((e) => e.category === name).length
    if (count > 0) {
      const confirmed = window.confirm(
        `Delete category "${name}"? ${count} expense(s) will be moved to "Other".`
      )
      if (!confirmed) return
    }
    dispatch({ type: 'DELETE_BUDGET_CATEGORY', name })
  }

  return (
    <section className="card blueprint elev-sm">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
          flexWrap: 'wrap',
        }}
      >
        <div className="card-title">Budget</div>
        <div className="seg">
          {(['monthly', 'yearly'] as const).map((opt) => (
            <label key={opt} className="seg-opt" onClick={() => setPeriod(opt)}>
              <input type="radio" name="budgetPeriod" checked={period === opt} readOnly />
              <span>{opt === 'monthly' ? 'Monthly' : 'Yearly'}</span>
            </label>
          ))}
        </div>
      </div>

      <div
        data-testid="summary-cards"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <div className="card blueprint elev-sm">
          <div className="text-muted">Income</div>
          <div style={{ fontSize: '1.5rem' }}>{fmtUSD(totalIncome)}</div>
        </div>
        <div className="card blueprint elev-sm">
          <div className="text-muted">Expenses</div>
          <div style={{ fontSize: '1.5rem' }}>{fmtUSD(totalExpense)}</div>
        </div>
        <div className="card blueprint elev-sm">
          <div className="text-muted">Net</div>
          <div style={{ fontSize: '1.5rem', color: net >= 0 ? GAIN_COLOR : LOSS_COLOR }}>
            {(net >= 0 ? '' : '-') + fmtUSD(Math.abs(net))}
          </div>
        </div>
      </div>

      <div className="card blueprint elev-sm">
        <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
          Income
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div className="field">
            <label>Monthly income</label>
            <input
              type="number"
              className="input"
              aria-label="Monthly income"
              value={state.budgetIncomeMonthly}
              onChange={(e) =>
                dispatch({ type: 'SET_BUDGET_INCOME_MONTHLY', amount: parseFloat(e.target.value) || 0 })
              }
            />
          </div>
          <div className="field">
            <label>Yearly income</label>
            <input
              type="number"
              className="input"
              aria-label="Yearly income"
              value={state.budgetIncomeYearly}
              onChange={(e) =>
                dispatch({ type: 'SET_BUDGET_INCOME_YEARLY', amount: parseFloat(e.target.value) || 0 })
              }
            />
          </div>
        </div>
      </div>

      <div className="card blueprint elev-sm">
        <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
          Add Expense
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field">
            <label>Name</label>
            <input
              type="text"
              className="input"
              aria-label="Expense name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Category</label>
            <select
              className="input"
              aria-label="Expense category"
              value={formCategory}
              onChange={(e) => {
                const value = e.target.value
                if (value === '__add_new') {
                  const result = window.prompt('New category name:')
                  if (result !== null && result.trim()) {
                    dispatch({ type: 'ADD_BUDGET_CATEGORY', name: result.trim() })
                    setFormCategory(result.trim())
                  }
                  return
                }
                setFormCategory(value)
              }}
            >
              {state.budgetCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
              {!state.budgetCategories.includes(formCategory) && formCategory !== '__add_new' && (
                <option value={formCategory}>{formCategory}</option>
              )}
              <option value="__add_new">+ Add category…</option>
            </select>
          </div>
          <div className="field">
            <label>Amount</label>
            <input
              type="number"
              className="input"
              aria-label="Expense amount"
              value={formAmount}
              onChange={(e) => setFormAmount(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Frequency</label>
            <select
              className="input"
              aria-label="Expense frequency"
              value={formFrequency}
              onChange={(e) => setFormFrequency(e.target.value as 'monthly' | 'yearly')}
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const amount = parseFloat(formAmount)
              if (!formName.trim() || !amount || amount <= 0) return
              dispatch({
                type: 'ADD_BUDGET_EXPENSE',
                expense: { name: formName.trim(), category: formCategory, amount, frequency: formFrequency },
              })
              setFormName('')
              setFormAmount('')
            }}
          >
            Add
          </button>
        </div>
      </div>

      <div className="card blueprint elev-sm" style={{ marginTop: 'var(--space-4)' }}>
        <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
          Category Breakdown
        </div>
        {breakdown.length === 0 ? (
          <div className="text-muted" style={{ fontSize: '12px' }}>
            Add expenses to see the breakdown.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {breakdownRows.map(({ name, amount, pct }) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{ width: '120px', flexShrink: 0 }}>{name}</div>
                <div
                  style={{
                    flex: 1,
                    background: 'var(--color-border, #e5e5e5)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    height: '8px',
                  }}
                >
                  <div
                    data-testid="category-bar-fill"
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: 'var(--color-accent)',
                    }}
                  />
                </div>
                <div style={{ width: '90px', textAlign: 'right', flexShrink: 0 }}>{fmtUSD(amount)}</div>
                {name !== 'Other' && (
                  <button
                    type="button"
                    style={textBtnDanger}
                    aria-label={`Delete category ${name}`}
                    onClick={() => handleDeleteCategory(name)}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          margin: 'var(--space-4) 0',
        }}
      >
        <div className="field">
          <label>Filter by category</label>
          <select
            className="input"
            aria-label="Filter by category"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="__all">All categories</option>
            {state.budgetCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Sort by</label>
          <select
            className="input"
            aria-label="Sort by"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'category' | 'name' | 'amount')}
          >
            <option value="category">Category</option>
            <option value="name">Name</option>
            <option value="amount">Amount ({period === 'monthly' ? 'Monthly' : 'Yearly'})</option>
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-muted" style={{ fontSize: '12px', padding: 'var(--space-4) 0' }}>
          No expenses to show.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Frequency</th>
              <th style={{ textAlign: 'right' }}>Amount ({period === 'monthly' ? 'Monthly' : 'Yearly'})</th>
              <th style={{ width: '110px' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isEditing = editingId === row.id
              return (
                <tr key={row.id}>
                  <td>
                    {isEditing ? (
                      <input
                        type="text"
                        className="input"
                        aria-label="Edit expense name"
                        value={row.name}
                        onChange={(e) =>
                          dispatch({ type: 'UPDATE_BUDGET_EXPENSE', id: row.id, patch: { name: e.target.value } })
                        }
                      />
                    ) : (
                      row.name
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <select
                        className="input"
                        aria-label="Edit expense category"
                        value={row.category}
                        onChange={(e) =>
                          dispatch({ type: 'UPDATE_BUDGET_EXPENSE', id: row.id, patch: { category: e.target.value } })
                        }
                      >
                        {state.budgetCategories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="tag tag-neutral">{row.category}</span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <select
                        className="input"
                        aria-label="Edit expense frequency"
                        value={row.frequency}
                        onChange={(e) =>
                          dispatch({
                            type: 'UPDATE_BUDGET_EXPENSE',
                            id: row.id,
                            patch: { frequency: e.target.value as 'monthly' | 'yearly' },
                          })
                        }
                      >
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    ) : row.frequency === 'monthly' ? (
                      'Monthly'
                    ) : (
                      'Yearly'
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {isEditing ? (
                      <input
                        type="number"
                        className="input"
                        aria-label="Edit expense amount"
                        value={row.amount}
                        onChange={(e) =>
                          dispatch({
                            type: 'UPDATE_BUDGET_EXPENSE',
                            id: row.id,
                            patch: { amount: parseFloat(e.target.value) || 0 },
                          })
                        }
                      />
                    ) : (
                      fmtUSD(toPeriod(row.amount, row.frequency, period))
                    )}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {isEditing ? (
                      <button type="button" style={textBtnAccent} onClick={() => setEditingId(null)}>
                        Done
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          style={{ ...textBtnAccent, marginRight: 'var(--space-3)' }}
                          onClick={() => setEditingId(row.id)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          style={textBtnDanger}
                          onClick={() => {
                            if (window.confirm('Delete this expense? This cannot be undone.')) {
                              dispatch({ type: 'DELETE_BUDGET_EXPENSE', id: row.id })
                            }
                          }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
