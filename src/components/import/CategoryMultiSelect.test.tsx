import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CategoryMultiSelect, type CategorySelection } from './CategoryMultiSelect'

afterEach(cleanup)

function setup(value: CategorySelection = { primary: 'taxable' }, existingCustomTags: string[] = []) {
  const onChange = vi.fn()
  function Host() {
    const [selection, setSelection] = useState(value)
    return <CategoryMultiSelect value={selection} existingCustomTags={existingCustomTags} onChange={(next) => { onChange(next); setSelection(next) }} />
  }
  render(<Host />)
  fireEvent.click(screen.getByText('Categories'))
  return onChange
}

function toggle(label: string) {
  fireEvent.click(screen.getByRole('checkbox', { name: label }))
}

function enter(text: string) {
  const input = screen.getByRole('textbox', { name: 'Add category' })
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('CategoryMultiSelect', () => {
  it('lists three bases and existing custom categories with the literal hint', () => {
    setup({ primary: 'taxable', tags: ['Family'] }, ['Family', 'Travel'])
    expect(screen.getAllByRole('checkbox')).toHaveLength(5)
    for (const label of ['Taxable', 'Non-Taxable', 'Tax-Deferred', 'Family', 'Travel']) {
      expect(screen.getByRole('checkbox', { name: label })).toBeTruthy()
    }
    expect(screen.getByText('2 of 4 selected · 5 of 6 categories')).toBeTruthy()
    expect(screen.getByPlaceholderText('Add a category, press Enter')).toBeTruthy()
  })

  it('toggles tags and omits empty tags in output', () => {
    const change = setup(undefined, ['Family'])
    toggle('Family')
    expect(change).toHaveBeenLastCalledWith({ primary: 'taxable', tags: ['Family'] })
    toggle('Family')
    expect(change).toHaveBeenLastCalledWith({ primary: 'taxable' })
  })

  it('cannot deselect the last category', () => {
    const change = setup()
    toggle('Taxable')
    expect(change).not.toHaveBeenCalled()
  })

  it('cannot leave only custom tags selected', () => {
    const change = setup({ primary: 'taxable', tags: ['Family'] }, ['Family'])
    toggle('Taxable')
    expect(change).not.toHaveBeenCalled()
  })

  it('adds and selects a trimmed custom tag with Enter', () => {
    const change = setup()
    enter(' x ')
    expect(change).toHaveBeenLastCalledWith({ primary: 'taxable', tags: ['x'] })
    expect((screen.getByRole('checkbox', { name: 'x' }) as HTMLInputElement).checked).toBe(true)
  })

  it('ignores blank and case-insensitive duplicate input', () => {
    const change = setup({ primary: 'taxable', tags: ['Family'] }, ['Family'])
    for (const text of ['', '   ', ' family ', 'TAXABLE']) enter(text)
    expect(change).not.toHaveBeenCalled()
  })

  it('offers an Add action for the typed category', () => {
    const change = setup()
    fireEvent.change(screen.getByRole('textbox', { name: 'Add category' }), { target: { value: 'Family' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add "Family"' }))
    expect(change).toHaveBeenLastCalledWith({ primary: 'taxable', tags: ['Family'] })
  })

  it('caps selections at four and updates the placeholder', () => {
    const change = setup({ primary: 'taxable', tags: ['Non-Taxable', 'Tax-Deferred', 'Family'] }, ['Family', 'Travel'])
    expect(screen.getByPlaceholderText('Category limit reached')).toBeTruthy()
    toggle('Travel')
    enter('New')
    expect(change).not.toHaveBeenCalled()
    toggle('Family')
    expect(screen.getByPlaceholderText('Add a category, press Enter')).toBeTruthy()
  })

  it('blocks the fourth portfolio custom tag but permits selecting an existing one', () => {
    const change = setup(undefined, ['Family', 'Travel', 'Goals'])
    enter('Fourth')
    expect(change).not.toHaveBeenCalled()
    toggle('Goals')
    expect(change).toHaveBeenLastCalledWith({ primary: 'taxable', tags: ['Goals'] })
  })

  it('retains the first-chosen base and promotes the next-chosen base on removal', () => {
    const change = setup({ primary: 'taxDeferred' })
    toggle('Taxable')
    toggle('Non-Taxable')
    expect(change).toHaveBeenLastCalledWith({ primary: 'taxDeferred', tags: ['Taxable', 'Non-Taxable'] })
    toggle('Tax-Deferred')
    expect(change).toHaveBeenLastCalledWith({ primary: 'taxable', tags: ['Non-Taxable'] })
    toggle('Taxable')
    expect(change).toHaveBeenLastCalledWith({ primary: 'nonTaxable' })
  })

  it('reflects external controlled value changes without emitting a change', () => {
    const change = vi.fn()
    const { rerender } = render(<CategoryMultiSelect value={{ primary: 'taxable' }} existingCustomTags={[]} onChange={change} />)
    rerender(<CategoryMultiSelect value={{ primary: 'taxDeferred', tags: ['Taxable'] }} existingCustomTags={[]} onChange={change} />)
    expect((screen.getByRole('checkbox', { name: 'Tax-Deferred', hidden: true }) as HTMLInputElement).checked).toBe(true)
    expect(change).not.toHaveBeenCalled()
  })
})
