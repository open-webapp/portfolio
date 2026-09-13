import { useState } from 'react'
import type { AppState, AppAction } from '../lib/state'
import { fmtUSD, GAIN_COLOR, LOSS_COLOR } from '../lib/computations'

const CATEGORIES = [
  'Housing',
  'Utilities',
  'Groceries',
  'Transportation',
  'Insurance',
  'Subscriptions',
  'Health',
  'Entertainment',
  'Debt/Loans',
  'Savings',
  'Other',
]

export interface BudgetPageProps {
  state: AppState
  dispatch: (action: AppAction) => void
}

export function BudgetPage({ state, dispatch }: BudgetPageProps) {
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const [filterCategory, setFilterCategory] = useState('__all')
  const [sortBy, setSortBy] = useState<'category' | 'name' | 'amount'>('category')
  const [formName, setFormName] = useState('')
  const [formCategory, setFormCategory] = useState(CATEGORIES[0])
  const [formAmount, setFormAmount] = useState('')
  const [formFrequency, setFormFrequency] = useState<'monthly' | 'yearly'>('monthly')
  const [editingId, setEditingId] = useState<string | null>(null)

  const toMonthly = (amount: number, freq: 'monthly' | 'yearly') => (freq === 'yearly' ? amount / 12 : amount)
  const toYearly = (amount: number, freq: 'monthly' | 'yearly') => (freq === 'yearly' ? amount : amount * 12)
  const toPeriod = (amount: number, freq: 'monthly' | 'yearly') =>
    period === 'monthly' ? toMonthly(amount, freq) : toYearly(amount, freq)

  const periodLabel = period === 'monthly' ? 'Monthly' : 'Yearly'

  const totalIncome =
    period === 'monthly'
      ? state.budgetIncomeMonthly + state.budgetIncomeYearly / 12
      : state.budgetIncomeMonthly * 12 + state.budgetIncomeYearly

  const totalExpense = state.budgetExpenses.reduce((sum, e) => sum + toPeriod(e.amount, e.frequency), 0)
  const net = totalIncome - totalExpense

  const visibleExpenses = state.budgetExpenses
    .filter((e) => filterCategory === '__all' || e.category === filterCategory)
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'amount') return toPeriod(b.amount, b.frequency) - toPeriod(a.amount, a.frequency)
      return a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
    })

  const byCategory: Record<string, number> = {}
  state.budgetExpenses.forEach((e) => {
    byCategory[e.category] = (byCategory[e.category] || 0) + toPeriod(e.amount, e.frequency)
  })
  const maxCat = Math.max(1, ...Object.values(byCategory))
  const categoryBreakdown = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount]) => ({
      name,
      displayAmount: fmtUSD(amount),
      pct: Math.round((amount / maxCat) * 100),
    }))

  const handleAddExpense = () => {
    const amount = parseFloat(formAmount)
    if (!formName.trim() || !amount || amount <= 0) return
    dispatch({
      type: 'ADD_BUDGET_EXPENSE',
      expense: { name: formName.trim(), category: formCategory, amount, frequency: formFrequency },
    })
    setFormName('')
    setFormAmount('')
    setFormCategory(CATEGORIES[0])
    setFormFrequency('monthly')
  }

  const handleDeleteExpense = (id: string) => {
    if (window.confirm('Delete this expense? This cannot be undone.')) {
      dispatch({ type: 'REMOVE_BUDGET_EXPENSE', id })
    }
  }

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-5)',
        }}
      >
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: '30px', fontWeight: 600 }}>Budget</h1>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>
            Track income and expenses by category.
          </div>
        </div>
        <div className="seg" style={{ display: 'inline-flex' }}>
          <button
            type="button"
            onClick={() => setPeriod('monthly')}
            style={{
              border: 'none',
              cursor: 'pointer',
              padding: '6px 16px',
              borderRadius: '999px',
              fontSize: '13px',
              fontWeight: 600,
              background: period === 'monthly' ? 'var(--color-accent)' : 'transparent',
              color: period === 'monthly' ? '#fff' : 'var(--color-text-secondary)',
            }}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setPeriod('yearly')}
            style={{
              border: 'none',
              cursor: 'pointer',
              padding: '6px 16px',
              borderRadius: '999px',
              fontSize: '13px',
              fontWeight: 600,
              background: period === 'yearly' ? 'var(--color-accent)' : 'transparent',
              color: period === 'yearly' ? '#fff' : 'var(--color-text-secondary)',
            }}
          >
            Yearly
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-5)',
        }}
      >
        {[
          { label: 'Income', value: fmtUSD(totalIncome), color: 'var(--color-text)' },
          { label: 'Expenses', value: fmtUSD(totalExpense), color: 'var(--color-text)' },
          {
            label: 'Net',
            value: (net >= 0 ? '' : '-') + fmtUSD(Math.abs(net)),
            color: net >= 0 ? GAIN_COLOR : LOSS_COLOR,
          },
        ].map(({ label, value, color }) => (
          <div key={label} className="card" style={{ padding: 'var(--space-4)' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
              {label} ({periodLabel})
            </div>
            <div style={{ fontSize: '24px', fontWeight: 600, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Income editor */}
      <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
        <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)' }}>
          Income
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '160px' }}>
            <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500, display: 'block', marginBottom: '4px' }}>
              Monthly income
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={state.budgetIncomeMonthly}
              onChange={(e) => dispatch({ type: 'SET_BUDGET_INCOME_MONTHLY', amount: parseFloat(e.target.value) || 0 })}
              className="input"
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ flex: 1, minWidth: '160px' }}>
            <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500, display: 'block', marginBottom: '4px' }}>
              Yearly income
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={state.budgetIncomeYearly}
              onChange={(e) => dispatch({ type: 'SET_BUDGET_INCOME_YEARLY', amount: parseFloat(e.target.value) || 0 })}
              className="input"
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
            Both are combined into totals — fill whichever applies.
          </div>
        </div>
      </div>

      {/* Main layout: expenses list + category breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 'var(--space-6)', alignItems: 'start' }}>
        {/* Left: expense list + add form */}
        <div>
          {/* Add expense form */}
          <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)' }}>
              Add expense
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 0.9fr auto', gap: 'var(--space-3)', alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500, display: 'block', marginBottom: '4px' }}>
                  Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Rent"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="input"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500, display: 'block', marginBottom: '4px' }}>
                  Category
                </label>
                <select value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="input" style={{ width: '100%' }}>
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500, display: 'block', marginBottom: '4px' }}>
                  Amount
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  className="input"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500, display: 'block', marginBottom: '4px' }}>
                  Frequency
                </label>
                <select value={formFrequency} onChange={(e) => setFormFrequency(e.target.value as 'monthly' | 'yearly')} className="input" style={{ width: '100%' }}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <button type="button" onClick={handleAddExpense} style={{ height: '36px', padding: '0 18px', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: '999px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}>
                Add
              </button>
            </div>
          </div>

          {/* Expenses table */}
          <div className="card" style={{ padding: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
                Expenses
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="input" style={{ height: '32px', padding: '0 8px', fontSize: '13px' }}>
                  <option value="__all">All categories</option>
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="input" style={{ height: '32px', padding: '0 8px', fontSize: '13px' }}>
                  <option value="category">Sort: Category</option>
                  <option value="name">Sort: Name</option>
                  <option value="amount">Sort: Amount ({periodLabel})</option>
                </select>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: visibleExpenses.length === 0 ? '0' : '0' }}>
              {visibleExpenses.length > 0 && (
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', fontWeight: 600, padding: '0 0 8px', borderBottom: '1px solid var(--color-divider)' }}>
                      Name
                    </th>
                    <th style={{ textAlign: 'left', fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', fontWeight: 600, padding: '0 0 8px', borderBottom: '1px solid var(--color-divider)' }}>
                      Category
                    </th>
                    <th style={{ textAlign: 'left', fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', fontWeight: 600, padding: '0 0 8px', borderBottom: '1px solid var(--color-divider)' }}>
                      Frequency
                    </th>
                    <th style={{ textAlign: 'right', fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', fontWeight: 600, padding: '0 0 8px', borderBottom: '1px solid var(--color-divider)' }}>
                      {periodLabel} amount
                    </th>
                    <th style={{ borderBottom: '1px solid var(--color-divider)' }}></th>
                  </tr>
                </thead>
              )}
              <tbody>
                {visibleExpenses.map((exp) => (
                  <tr key={exp.id} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                    <td style={{ padding: '10px 8px 10px 0', fontSize: '14px' }}>
                      {editingId === exp.id ? (
                        <input
                          type="text"
                          value={exp.name}
                          onChange={(e) => dispatch({ type: 'UPDATE_BUDGET_EXPENSE', id: exp.id, patch: { name: e.target.value } })}
                          className="input"
                          style={{ width: '100%', height: '32px' }}
                        />
                      ) : (
                        <span>{exp.name}</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: '14px' }}>
                      {editingId === exp.id ? (
                        <select value={exp.category} onChange={(e) => dispatch({ type: 'UPDATE_BUDGET_EXPENSE', id: exp.id, patch: { category: e.target.value } })} className="input" style={{ height: '32px', padding: '0 6px', fontSize: '13px' }}>
                          {CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="tag">{exp.category}</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                      {editingId === exp.id ? (
                        <select value={exp.frequency} onChange={(e) => dispatch({ type: 'UPDATE_BUDGET_EXPENSE', id: exp.id, patch: { frequency: e.target.value as any } })} className="input" style={{ height: '32px', padding: '0 6px', fontSize: '13px' }}>
                          <option value="monthly">Monthly</option>
                          <option value="yearly">Yearly</option>
                        </select>
                      ) : (
                        exp.frequency === 'monthly' ? 'Monthly' : 'Yearly'
                      )}
                    </td>
                    <td style={{ padding: '10px 0 10px 8px', textAlign: 'right', fontSize: '14px' }}>
                      {editingId === exp.id ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={exp.amount}
                          onChange={(e) => dispatch({ type: 'UPDATE_BUDGET_EXPENSE', id: exp.id, patch: { amount: parseFloat(e.target.value) || 0 } })}
                          className="input"
                          style={{ height: '32px', width: '100px', textAlign: 'right', padding: '0 8px' }}
                        />
                      ) : (
                        <span style={{ fontWeight: 600 }}>{fmtUSD(toPeriod(exp.amount, exp.frequency))}</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right', padding: '10px 0' }}>
                      <button
                        type="button"
                        onClick={() => setEditingId(editingId === exp.id ? null : exp.id)}
                        style={{ border: 'none', background: 'none', color: 'var(--color-accent)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                      >
                        {editingId === exp.id ? 'Done' : 'Edit'}
                      </button>
                      {editingId !== exp.id && (
                        <button type="button" onClick={() => handleDeleteExpense(exp.id)} style={{ border: 'none', background: 'none', color: '#e2574c', fontSize: '13px', fontWeight: 600, cursor: 'pointer', marginLeft: '8px' }}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {visibleExpenses.length === 0 && <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '14px' }}>No expenses to show.</div>}
          </div>
        </div>

        {/* Right: category breakdown */}
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
            By category ({periodLabel})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {categoryBreakdown.map(({ name, displayAmount, pct }) => (
              <div key={name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                  <span>{name}</span>
                  <span style={{ fontWeight: 600 }}>{displayAmount}</span>
                </div>
                <div style={{ height: '6px', background: 'var(--color-divider)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'var(--color-accent)', width: `${pct}%` }}></div>
                </div>
              </div>
            ))}
            {categoryBreakdown.length === 0 && <div style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>Add expenses to see the breakdown.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
