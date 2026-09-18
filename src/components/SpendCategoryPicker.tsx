import type { Expense } from '../lib/types'

export interface SpendCategoryPickerProps {
  expenses: Expense[]
  categoriesById: Map<string, string>
  value: string
  onChange: (expenseId: string, categoryId: string) => void
  ariaLabel: string
  fallbackCategoryId: string
}

/**
 * SpendCategoryPicker component: dropdown for selecting the Expense a Spend
 * record is attributed to. Options are Expenses (not raw categories),
 * labelled "<expense name> (<category name>)".
 */
export function SpendCategoryPicker({
  expenses,
  categoriesById,
  value,
  onChange,
  ariaLabel,
  fallbackCategoryId = '',
}: SpendCategoryPickerProps) {
  if (expenses.length === 0) {
    return (
      <select className="input" aria-label={ariaLabel} value="" disabled>
        <option value="">No expenses defined for this year</option>
      </select>
    )
  }

  const sortedExpenses = [...expenses].sort((a, b) => a.name.localeCompare(b.name))

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value
    if (selectedId === '') {
      onChange('', fallbackCategoryId)
      return
    }
    const expense = expenses.find((exp) => exp.id === selectedId)
    if (!expense) return
    onChange(expense.id, expense.categoryId)
  }

  return (
    <select className="input" aria-label={ariaLabel} value={value} onChange={handleChange}>
      <option value="">— Uncategorized —</option>
      {sortedExpenses.map((exp) => (
        <option key={exp.id} value={exp.id}>
          {exp.name} ({categoriesById.get(exp.categoryId) ?? exp.categoryId})
        </option>
      ))}
    </select>
  )
}
