import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SpendCategoryPicker } from './SpendCategoryPicker'
import type { ExpenseDefinition } from '../lib/types'

const definitions: ExpenseDefinition[] = [
  { id: 'e1', name: 'Zebra Rent', categoryId: 'c1', frequency: 'monthly' },
  { id: 'e2', name: 'Alpha Gym', categoryId: 'c2', frequency: 'monthly' },
  { id: 'e3', name: 'Mid Internet', categoryId: 'c1', frequency: 'monthly' },
]

const categoriesById = new Map<string, string>([
  ['c1', 'Housing'],
  ['c2', 'Health'],
])

describe('SpendCategoryPicker', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders options sorted alphabetically by expense name with correct label', () => {
    render(
      <SpendCategoryPicker
        definitions={definitions}
        categoriesById={categoriesById}
        value="e1"
        onChange={() => {}}
        ariaLabel="Spend category"
      />
    )

    const select = screen.getByLabelText('Spend category')
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
    expect(options).toEqual([
      '— Uncategorized —',
      'Alpha Gym (Health)',
      'Mid Internet (Housing)',
      'Zebra Rent (Housing)',
    ])
  })

  it('calls onChange with expense id and categoryId when an option is selected', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <SpendCategoryPicker
        definitions={definitions}
        categoriesById={categoriesById}
        value="e1"
        onChange={handleChange}
        ariaLabel="Spend category"
      />
    )

    const select = screen.getByLabelText('Spend category')
    await user.selectOptions(select, 'e2')

    expect(handleChange).toHaveBeenCalledWith('e2', 'c2')
  })

  it('renders disabled placeholder select when definitions array is empty', () => {
    render(
      <SpendCategoryPicker
        definitions={[]}
        categoriesById={categoriesById}
        value=""
        onChange={() => {}}
        ariaLabel="Spend category"
      />
    )

    const select = screen.getByLabelText('Spend category') as HTMLSelectElement
    expect(select.disabled).toBe(true)
    const options = Array.from(select.querySelectorAll('option'))
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toBe('No expenses defined')
  })

  it('renders without crashing when value matches no current option', () => {
    render(
      <SpendCategoryPicker
        definitions={definitions}
        categoriesById={categoriesById}
        value="dangling-id"
        onChange={() => {}}
        ariaLabel="Spend category"
      />
    )

    const select = screen.getByLabelText('Spend category')
    expect(select).toBeTruthy()
  })

  it('renders "— Uncategorized —" as the first option when value is ""', () => {
    render(
      <SpendCategoryPicker
        definitions={definitions}
        categoriesById={categoriesById}
        value=""
        onChange={() => {}}
        ariaLabel="Spend category"
      />
    )

    const select = screen.getByLabelText('Spend category')
    const options = Array.from(select.querySelectorAll('option'))
    expect(options[0].textContent).toBe('— Uncategorized —')
    expect((options[0] as HTMLOptionElement).value).toBe('')
  })

  it('clears the link (calls onChange with empty expense id) when the placeholder is selected after a prior selection', () => {
    const handleChange = vi.fn()

    render(
      <SpendCategoryPicker
        definitions={definitions}
        categoriesById={categoriesById}
        value="e1"
        onChange={handleChange}
        ariaLabel="Spend category"
      />
    )

    const select = screen.getByLabelText('Spend category') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '' } })

    expect(handleChange).toHaveBeenCalledWith('', expect.any(String))
  })

  it('keeps the "no expenses defined" disabled-select messaging without adding a placeholder option', () => {
    render(
      <SpendCategoryPicker
        definitions={[]}
        categoriesById={categoriesById}
        value=""
        onChange={() => {}}
        ariaLabel="Spend category"
      />
    )

    const select = screen.getByLabelText('Spend category') as HTMLSelectElement
    expect(select.disabled).toBe(true)
    const options = Array.from(select.querySelectorAll('option'))
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toBe('No expenses defined')
    expect(options[0].textContent).not.toBe('— Uncategorized —')
  })
})
