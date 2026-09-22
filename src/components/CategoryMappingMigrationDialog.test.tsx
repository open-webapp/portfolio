import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CategoryMappingMigrationDialog } from './CategoryMappingMigrationDialog'

afterEach(() => {
  cleanup()
})

const mappings = [
  { id: 'mapping-1', substring: 'market', spendExpenseId: 'expense-1', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'mapping-2', substring: 'fuel', spendExpenseId: 'expense-2', updatedAt: '2026-01-01T00:00:00.000Z' },
]

describe('CategoryMappingMigrationDialog', () => {
  it('shows the mapping count and confirms the captured expense ids', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onDismiss = vi.fn()
    render(<CategoryMappingMigrationDialog open mappings={mappings} onConfirm={onConfirm} onDismiss={onDismiss} />)

    expect(screen.getByText(/2 category mappings were copied/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from shared store' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(new Set(['expense-1', 'expense-2'])))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('dismisses without confirming', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onDismiss = vi.fn()
    render(<CategoryMappingMigrationDialog open mappings={mappings} onConfirm={onConfirm} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: 'Keep for now' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('shows an inline error when removal fails', async () => {
    render(<CategoryMappingMigrationDialog open mappings={mappings} onConfirm={vi.fn().mockRejectedValue(new Error('IDB failed'))} onDismiss={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove from shared store' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not remove/i)
  })
})
