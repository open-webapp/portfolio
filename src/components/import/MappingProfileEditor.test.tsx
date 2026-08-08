import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MappingProfileEditor } from './MappingProfileEditor'

afterEach(cleanup)

describe('MappingProfileEditor', () => {
  it('offers taxes as a mappable field for transactions imports', () => {
    render(
      <MappingProfileEditor
        kind="transactions"
        csvHeaders={['Date', 'Symbol', 'Type', 'Shares', 'Price', 'Amount', 'Tax Withheld']}
        onSave={() => {}}
        onCancel={() => {}}
      />
    )

    expect(screen.getByText('taxes:')).toBeTruthy()
  })

  it('offers taxes as a mappable field for positions imports', () => {
    render(
      <MappingProfileEditor
        kind="positions"
        csvHeaders={['Symbol', 'Asset Class', 'Shares', 'Avg Cost', 'Price', 'Tax Withheld']}
        onSave={() => {}}
        onCancel={() => {}}
      />
    )

    expect(screen.getByText('taxes:')).toBeTruthy()
  })

  // Regression: `name` was removed from POSITIONS_REQUIRED_FIELDS (making it optional
  // on import) but never added to POSITIONS_OPTIONAL_FIELDS, so the editor offered no
  // dropdown for it at all — imported positions always got name: null even when the
  // CSV had a Name/Description column.
  it('offers name as a mappable (optional) field for positions imports', () => {
    render(
      <MappingProfileEditor
        kind="positions"
        csvHeaders={['Symbol', 'Description', 'Asset Class', 'Shares', 'Avg Cost', 'Price']}
        onSave={() => {}}
        onCancel={() => {}}
      />
    )

    expect(screen.getByText('name:')).toBeTruthy()
  })

  // New: constant-value option tests
  it('includes "Enter a value..." option in field dropdowns', () => {
    render(
      <MappingProfileEditor
        kind="positions"
        csvHeaders={['Symbol', 'Asset Class', 'Shares', 'Avg Cost', 'Price']}
        onSave={() => {}}
        onCancel={() => {}}
      />
    )

    const selects = screen.getAllByRole('combobox')
    expect(selects.length).toBeGreaterThan(0)

    // Check that at least one select contains the "Enter a value..." option
    const hasConstantOption = selects.some((select) => {
      const options = Array.from(select.querySelectorAll('option'))
      return options.some((opt) => opt.textContent === 'Enter a value...')
    })
    expect(hasConstantOption).toBe(true)
  })

  it('reveals text input when "Enter a value..." is selected for a field', () => {
    render(
      <MappingProfileEditor
        kind="positions"
        csvHeaders={['Symbol', 'Asset Class', 'Shares', 'Avg Cost', 'Price']}
        onSave={() => {}}
        onCancel={() => {}}
      />
    )

    // Get the select for 'symbol' field (first required field)
    const selects = screen.getAllByRole('combobox')
    const symbolSelect = selects[0] as HTMLSelectElement

    // Select "Enter a value..."
    fireEvent.change(symbolSelect, { target: { value: '__CONSTANT__' } })

    // Check that a text input with placeholder "Enter constant value" appears
    const constantInputs = screen.getAllByPlaceholderText('Enter constant value')
    expect(constantInputs.length).toBeGreaterThan(0)
  })

  it('calls onConstantsChange when constant value is entered', () => {
    const onConstantsChange = vi.fn()

    render(
      <MappingProfileEditor
        kind="positions"
        csvHeaders={['Symbol', 'Asset Class', 'Shares', 'Avg Cost', 'Price']}
        onSave={() => {}}
        onCancel={() => {}}
        onConstantsChange={onConstantsChange}
      />
    )

    const selects = screen.getAllByRole('combobox')
    const symbolSelect = selects[0] as HTMLSelectElement

    // Select "Enter a value..."
    fireEvent.change(symbolSelect, { target: { value: '__CONSTANT__' } })

    // Type a constant value
    const constantInput = screen.getByPlaceholderText('Enter constant value') as HTMLInputElement
    fireEvent.change(constantInput, { target: { value: 'TSLA' } })

    // Verify onConstantsChange was called with the field and value
    expect(onConstantsChange).toHaveBeenCalledWith('symbol', 'TSLA')
  })

  it('includes constants in saved profile when "Save as profile" is clicked', () => {
    const onSave = vi.fn()

    render(
      <MappingProfileEditor
        kind="positions"
        csvHeaders={['Symbol', 'Asset Class', 'Shares', 'Avg Cost', 'Price']}
        onSave={onSave}
        onCancel={() => {}}
      />
    )

    const selects = screen.getAllByRole('combobox')
    const symbolSelect = selects[0] as HTMLSelectElement
    const assetClassSelect = selects[1] as HTMLSelectElement
    const sharesSelect = selects[2] as HTMLSelectElement
    const avgCostSelect = selects[3] as HTMLSelectElement
    const priceSelect = selects[5] as HTMLSelectElement // skip purchaseAmount (index 4)

    // Map required fields to CSV columns
    fireEvent.change(assetClassSelect, { target: { value: 'Asset Class' } })
    fireEvent.change(sharesSelect, { target: { value: 'Shares' } })
    fireEvent.change(avgCostSelect, { target: { value: 'Avg Cost' } })
    fireEvent.change(priceSelect, { target: { value: 'Price' } })

    // Select "Enter a value..." for symbol
    fireEvent.change(symbolSelect, { target: { value: '__CONSTANT__' } })

    // Enter constant value for symbol
    const constantInput = screen.getByPlaceholderText('Enter constant value') as HTMLInputElement
    fireEvent.change(constantInput, { target: { value: 'FIXED_SYMBOL' } })

    // Save profile
    const saveButton = screen.getByRole('button', { name: /Save as profile/i })
    fireEvent.click(saveButton)

    // Verify onSave was called
    expect(onSave).toHaveBeenCalled()
    const savedProfile = onSave.mock.calls[0][0]

    // Verify the saved profile contains both fieldMap and constants
    expect(savedProfile.fieldMap).toEqual({
      'Asset Class': 'assetClass',
      'Shares': 'shares',
      'Avg Cost': 'avgCost',
      'Price': 'price',
    })
    expect(savedProfile.constants).toEqual({ symbol: 'FIXED_SYMBOL' })
  })

  it('renders constants passed as props in the editor', () => {
    render(
      <MappingProfileEditor
        kind="positions"
        csvHeaders={['Symbol', 'Asset Class', 'Shares', 'Avg Cost', 'Price']}
        onSave={() => {}}
        onCancel={() => {}}
        constants={{ symbol: 'PRESET_SYMBOL' }}
      />
    )

    // Verify the constant value appears in the input
    const constantInput = screen.getByDisplayValue('PRESET_SYMBOL')
    expect(constantInput).toBeTruthy()

    // Verify the select shows "__CONSTANT__" is selected for that field
    const selects = screen.getAllByRole('combobox')
    const symbolSelect = selects[0] as HTMLSelectElement
    expect(symbolSelect.value).toBe('__CONSTANT__')
  })

  it('allows constant and fieldMap mappings to coexist for different fields', () => {
    const onSave = vi.fn()

    render(
      <MappingProfileEditor
        kind="positions"
        csvHeaders={['Symbol', 'Asset Class', 'Shares', 'Avg Cost', 'Price']}
        onSave={onSave}
        onCancel={() => {}}
      />
    )

    const selects = screen.getAllByRole('combobox')
    const symbolSelect = selects[0] as HTMLSelectElement
    const assetClassSelect = selects[1] as HTMLSelectElement
    const sharesSelect = selects[2] as HTMLSelectElement
    const avgCostSelect = selects[3] as HTMLSelectElement
    const priceSelect = selects[5] as HTMLSelectElement // skip purchaseAmount (index 4)

    // Map some fields to CSV columns
    fireEvent.change(assetClassSelect, { target: { value: 'Asset Class' } })
    fireEvent.change(sharesSelect, { target: { value: 'Shares' } })
    fireEvent.change(avgCostSelect, { target: { value: 'Avg Cost' } })
    fireEvent.change(priceSelect, { target: { value: 'Price' } })

    // Use constants for symbol
    fireEvent.change(symbolSelect, { target: { value: '__CONSTANT__' } })
    const constantInputs = screen.getAllByPlaceholderText('Enter constant value')
    fireEvent.change(constantInputs[0], { target: { value: 'CONST_SYMBOL' } })

    // Save profile
    const saveButton = screen.getByRole('button', { name: /Save as profile/i })
    fireEvent.click(saveButton)

    // Verify both fieldMap and constants are in the saved profile
    expect(onSave).toHaveBeenCalled()
    const savedProfile = onSave.mock.calls[0][0]

    expect(savedProfile.fieldMap).toEqual({
      'Asset Class': 'assetClass',
      'Shares': 'shares',
      'Avg Cost': 'avgCost',
      'Price': 'price',
    })
    expect(savedProfile.constants).toEqual({
      symbol: 'CONST_SYMBOL',
    })
  })
})
