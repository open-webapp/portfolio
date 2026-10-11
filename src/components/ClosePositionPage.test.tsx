import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ClosePositionPage } from './ClosePositionPage'
import type { Account, Position } from '../lib/types'

afterEach(cleanup)

const accounts: Account[] = [{ id: 'acc-1', accountNumber: '001', name: 'Brokerage', institution: 'Fidelity', retirement: false, createdAt: '2026-01-01' }]
const lot = (overrides: Partial<Position> = {}): Position => ({ id: 'lot-1', accountId: 'acc-1', symbol: 'ACME', name: 'Acme', assetClass: 'Equity', shares: 10, avgCost: 100, price: 120, lastImportedAt: '2026-01-01', ...overrides })

function renderPage(positions: Position[] = [lot()]) {
  const dispatch = vi.fn()
  const onCancel = vi.fn()
  render(<ClosePositionPage positions={positions} accounts={accounts} dispatch={dispatch} onCancel={onCancel} onClosed={vi.fn()} />)
  return { dispatch, onCancel }
}

describe('ClosePositionPage', () => {
  it('uses the first lot and sale defaults', () => {
    renderPage()
    expect(screen.getByDisplayValue('10')).toBeTruthy()
    expect(screen.getByDisplayValue('120')).toBeTruthy()
    expect(screen.getByDisplayValue('0')).toBeTruthy()
    expect((screen.getByLabelText('Sale date') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('hides the lot selector for a single lot', () => {
    renderPage()
    expect(screen.queryByLabelText('Position lot')).toBeNull()
  })

  it('changes the preview when selecting another lot', () => {
    renderPage([lot({ id: 'lot-1', avgCost: 100 }), lot({ id: 'lot-2', accountId: 'acc-1', avgCost: 90, shares: 5 })])
    fireEvent.change(screen.getByLabelText('Position lot'), { target: { value: 'lot-2' } })
    expect(screen.getByDisplayValue('5')).toBeTruthy()
    expect(screen.getByText('$150.00')).toBeTruthy()
  })

  it('renders the literal sale preview', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Fees'), { target: { value: '5' } })
    expect(screen.getByText('$195.00')).toBeTruthy()
    expect(screen.getByText('$1,200.00')).toBeTruthy()
  })

  it.each([
    ['Shares', '0', 'Enter shares greater than 0.'],
    ['Shares', '11', 'Shares cannot exceed 10.'],
    ['Sale price', '-1', 'Enter a non-negative sale price.'],
    ['Sale date', '', 'Enter a sale date.'],
  ])('disables confirmation for invalid %s', (label, value, message) => {
    renderPage()
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
    expect(screen.getByText(message)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Close position' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('dispatches the close sale payload and switches views', () => {
    const dispatch = vi.fn()
    const onClosed = vi.fn()
    render(<ClosePositionPage positions={[lot()]} accounts={accounts} dispatch={dispatch} onCancel={vi.fn()} onClosed={onClosed} />)
    fireEvent.change(screen.getByLabelText('Fees'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close position' }))
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'CLOSE_POSITION_WITH_SALE', positionId: 'lot-1', shares: 10, price: 120, fees: 5 }))
    expect(onClosed).toHaveBeenCalledOnce()
  })

  it('cancels without dispatching', () => {
    const { dispatch, onCancel } = renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(dispatch).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('shows remaining shares for a partial sale', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Shares'), { target: { value: '4' } })
    expect(screen.getByText('6.00 shares')).toBeTruthy()
  })
})
