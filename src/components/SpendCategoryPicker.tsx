import type { ExpenseDefinition } from '../lib/types'

export interface SpendCategoryPickerProps {
  definitions: ExpenseDefinition[]
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
  definitions,
  categoriesById,
  value,
  onChange,
  ariaLabel,
  fallbackCategoryId = '',
}: SpendCategoryPickerProps) {
  if (definitions.length === 0) {
    return (
      <select className="input" aria-label={ariaLabel} value="" disabled>
        <option value="">No expenses defined</option>
      </select>
    )
  }

  const sortedDefinitions = [...definitions].sort((a, b) => a.name.localeCompare(b.name))

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value
    if (selectedId === '') {
      onChange('', fallbackCategoryId)
      return
    }
    const definition = definitions.find((def) => def.id === selectedId)
    if (!definition) return
    onChange(definition.id, definition.categoryId)
  }

  return (
    <select className="input" aria-label={ariaLabel} value={value} onChange={handleChange}>
      <option value="">— Uncategorized —</option>
      {sortedDefinitions.map((def) => (
        <option key={def.id} value={def.id}>
          {def.name} ({categoriesById.get(def.categoryId) ?? def.categoryId})
        </option>
      ))}
    </select>
  )
}
