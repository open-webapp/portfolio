import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ManageCategoriesPage } from './ManageCategoriesPage'
import type { Category } from '../lib/types'
import { navigateToPicker } from '../lib/router'

vi.mock('../lib/router', () => ({
  navigateToPicker: vi.fn(),
}))

const categories: Category[] = [
  { id: 'food', name: 'Food', updatedAt: '2026-09-21T00:00:00.000Z' },
  { id: 'bills', name: 'Bills', updatedAt: '2026-09-21T00:00:00.000Z', excludeFromSpend: true },
  { id: 'other', name: 'Other', updatedAt: '2026-09-21T00:00:00.000Z' },
]

function renderPage(overrides: Partial<React.ComponentProps<typeof ManageCategoriesPage>> = {}) {
  const categoryDispatch = vi.fn()
  render(
    <ManageCategoriesPage
      categories={categories}
      categoryDispatch={categoryDispatch}
      categoriesHydrated={true}
      {...overrides}
    />
  )
  return categoryDispatch
}

describe('ManageCategoriesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders categories and returns to the picker', () => {
    renderPage()

    expect(screen.getByText('Food')).toBeTruthy()
    expect(screen.getByText('Bills')).toBeTruthy()
    expect(screen.getByText('Other')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(navigateToPicker).toHaveBeenCalledOnce()
  })

  it('renames a category via click-to-edit, committing on blur', () => {
    const categoryDispatch = renderPage()

    fireEvent.click(screen.getByText('Food'))
    fireEvent.change(screen.getByLabelText('Category name for Food'), { target: { value: 'Groceries' } })
    fireEvent.blur(screen.getByLabelText('Category name for Food'))

    expect(categoryDispatch).toHaveBeenCalledWith({ type: 'RENAME_CATEGORY', id: 'food', name: 'Groceries' })
  })

  it('commits a rename on Enter', () => {
    const categoryDispatch = renderPage()

    fireEvent.click(screen.getByText('Food'))
    fireEvent.change(screen.getByLabelText('Category name for Food'), { target: { value: 'Groceries' } })
    fireEvent.keyDown(screen.getByLabelText('Category name for Food'), { key: 'Enter' })

    expect(categoryDispatch).toHaveBeenCalledWith({ type: 'RENAME_CATEGORY', id: 'food', name: 'Groceries' })
  })

  it('reverts a rename with no dispatch on Escape', () => {
    const categoryDispatch = renderPage()

    fireEvent.click(screen.getByText('Food'))
    fireEvent.change(screen.getByLabelText('Category name for Food'), { target: { value: 'Groceries' } })
    fireEvent.keyDown(screen.getByLabelText('Category name for Food'), { key: 'Escape' })

    expect(categoryDispatch).not.toHaveBeenCalled()
    expect(screen.getByText('Food')).toBeTruthy()
  })

  it('reverts silently on empty/whitespace-only commit', () => {
    const categoryDispatch = renderPage()

    fireEvent.click(screen.getByText('Food'))
    fireEvent.change(screen.getByLabelText('Category name for Food'), { target: { value: '   ' } })
    fireEvent.blur(screen.getByLabelText('Category name for Food'))

    expect(categoryDispatch).not.toHaveBeenCalled()
    expect(screen.getByText('Food')).toBeTruthy()
  })

  it('sets exclude-from-spend based on the checkbox toggle direction', () => {
    const categoryDispatch = renderPage()

    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getAllByRole('checkbox')[1])

    expect(categoryDispatch).toHaveBeenNthCalledWith(1, {
      type: 'SET_CATEGORY_EXCLUDE_FROM_SPEND', id: 'food', exclude: true,
    })
    expect(categoryDispatch).toHaveBeenNthCalledWith(2, {
      type: 'SET_CATEGORY_EXCLUDE_FROM_SPEND', id: 'bills', exclude: false,
    })
  })

  it('deletes a non-Other category after confirmation', () => {
    const categoryDispatch = renderPage()
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    fireEvent.click(screen.getByRole('button', { name: 'Delete Food' }))

    expect(categoryDispatch).toHaveBeenCalledWith({ type: 'DELETE_CATEGORY', id: 'food' })
  })

  it('does not delete a category when confirmation is cancelled', () => {
    const categoryDispatch = renderPage()
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))

    fireEvent.click(screen.getByRole('button', { name: 'Delete Food' }))

    expect(categoryDispatch).not.toHaveBeenCalled()
  })

  it('does not allow the Other category to be deleted', () => {
    const categoryDispatch = renderPage()
    vi.stubGlobal('alert', vi.fn())

    fireEvent.click(screen.getByRole('button', { name: 'Delete Other' }))

    expect(window.alert).toHaveBeenCalledWith('The "Other" category cannot be deleted.')
    expect(categoryDispatch).not.toHaveBeenCalledWith({ type: 'DELETE_CATEGORY', id: 'other' })
  })

  it('adds a trimmed category name and clears the input', () => {
    const categoryDispatch = renderPage()
    const input = screen.getByLabelText('New category name') as HTMLInputElement

    fireEvent.change(input, { target: { value: ' Travel ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(categoryDispatch).toHaveBeenCalledWith({
      type: 'ADD_CATEGORY', id: expect.any(String), name: 'Travel',
    })
    expect(input.value).toBe('')
  })

  it('does not add a blank or whitespace-only category', () => {
    const categoryDispatch = renderPage()
    const input = screen.getByLabelText('New category name')

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(categoryDispatch).not.toHaveBeenCalled()
  })

  it('shows only a loading placeholder until categories hydrate', () => {
    renderPage({ categoriesHydrated: false })

    expect(screen.getByText('Loading categories...')).toBeTruthy()
    expect(screen.queryByText('Food')).toBeFalsy()
    expect(screen.queryByLabelText('New category name')).toBeFalsy()
  })
})
