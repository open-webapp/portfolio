import { expenseTableYears } from './selectors'
import type { BudgetTransaction, Category, ExpenseDefinition } from './types'

function csvText(value: string): string {
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safeValue) ? `"${safeValue.replace(/"/g, '""')}"` : safeValue
}

function csvField(value: string | number): string {
  return typeof value === 'number' ? String(value) : csvText(value)
}

/** Build a complete expense-definition CSV without including actual transaction data. */
export function buildExpenseCsv(
  definitions: ExpenseDefinition[],
  amountsByYear: Record<string, Record<string, number>>,
  transactions: BudgetTransaction[],
  categories: Category[],
  now: Date
): string {
  const years = expenseTableYears(transactions, amountsByYear, now)
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]))
  const sortedDefinitions = [...definitions].sort((a, b) => {
    const categoryA = categoryNames.get(a.categoryId) ?? a.categoryId
    const categoryB = categoryNames.get(b.categoryId) ?? b.categoryId
    return categoryA.localeCompare(categoryB) || a.name.localeCompare(b.name)
  })
  const header = ['Name', 'Category', 'Frequency', ...years]
  const rows: Array<Array<string | number>> = sortedDefinitions.map((definition) => [
    definition.name,
    categoryNames.get(definition.categoryId) ?? definition.categoryId,
    definition.frequency === 'monthly' ? 'Monthly' : 'Yearly',
    ...years.map((year) => {
      const amount = amountsByYear[year]?.[definition.id]
      return amount === undefined ? '' : amount
    })
  ])

  return [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}
