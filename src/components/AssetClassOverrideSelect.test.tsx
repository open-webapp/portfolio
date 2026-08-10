import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AssetClassOverrideSelect } from './AssetClassOverrideSelect'
import type { Position } from '../lib/types'

describe('AssetClassOverrideSelect', () => {
  const mockDispatch = vi.fn()

  const mockPosition: Position = {
    id: 'pos-1',
    accountId: 'acc-1',
    symbol: 'TEST',
    name: 'Test Position',
    assetClass: 'Equity',
    shares: 100,
    avgCost: 50,
    price: 75,
    taxes: null,
    lastImportedAt: '2024-01-01',
  }

  it('should only show existing asset classes from the existingAssetClasses prop', () => {
    const existingClasses = ['Equity', 'Crypto', 'Fixed Income']

    const { container } = render(
      <AssetClassOverrideSelect
        position={mockPosition}
        dispatch={mockDispatch}
        existingAssetClasses={existingClasses}
      />
    )

    // Open the dropdown
    const button = container.querySelector('button')!
    fireEvent.click(button)

    // Verify only existing classes are shown
    expect(screen.getByText('Equity')).toBeDefined()
    expect(screen.getByText('Crypto')).toBeDefined()
    expect(screen.getByText('Fixed Income')).toBeDefined()

    // Verify that hardcoded non-existent classes are NOT shown
    expect(screen.queryByText('Mutual Fund')).toBeNull()
    expect(screen.queryByText('Cash')).toBeNull()
    expect(screen.queryByText('ETF')).toBeNull()
  })

  it('should allow user to select from existing asset classes', () => {
    const existingClasses = ['Equity', 'Crypto']
    mockDispatch.mockClear()

    const { container } = render(
      <AssetClassOverrideSelect
        position={mockPosition}
        dispatch={mockDispatch}
        existingAssetClasses={existingClasses}
      />
    )

    // Open the dropdown
    const button = container.querySelector('button')!
    fireEvent.click(button)

    // Click on Crypto (use getAllByText and take the first one)
    const cryptoOptions = screen.getAllByText('Crypto')
    fireEvent.click(cryptoOptions[0])

    // Verify dispatch was called
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SET_ASSET_CLASS_OVERRIDE',
        positionId: 'pos-1',
        override: 'Crypto',
      })
    )
  })

  it('should allow free-typing a new asset class value', () => {
    const existingClasses = ['Equity', 'Crypto']
    mockDispatch.mockClear()

    const { container } = render(
      <AssetClassOverrideSelect
        position={mockPosition}
        dispatch={mockDispatch}
        existingAssetClasses={existingClasses}
      />
    )

    // Open the dropdown
    const button = container.querySelector('button')!
    fireEvent.click(button)

    // Type a new value
    const inputs = screen.getAllByPlaceholderText('Type or select...')
    fireEvent.change(inputs[0], { target: { value: 'NewClass' } })

    // The "+ Use" option should appear
    const newOptions = screen.getAllByText('+ Use "NewClass"')
    fireEvent.click(newOptions[0])

    // Verify dispatch was called with the new value
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SET_ASSET_CLASS_OVERRIDE',
        positionId: 'pos-1',
        override: 'NewClass',
      })
    )
  })

  it('should show empty state when no existing asset classes', () => {
    const existingClasses: string[] = []

    const { container } = render(
      <AssetClassOverrideSelect
        position={mockPosition}
        dispatch={mockDispatch}
        existingAssetClasses={existingClasses}
      />
    )

    // Open the dropdown
    const button = container.querySelector('button')!
    fireEvent.click(button)

    // Should show "No options found"
    expect(screen.getByText('No options found')).toBeDefined()
  })
})
