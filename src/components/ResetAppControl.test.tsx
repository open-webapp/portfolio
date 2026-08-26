import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ResetAppControl } from './ResetAppControl'

describe('ResetAppControl', () => {
  afterEach(() => {
    cleanup()
  })

  it('opens the confirm dialog on trigger click, and enables Erase Everything only when RESET is typed exactly (case-insensitive)', () => {
    render(<ResetAppControl onReset={vi.fn().mockResolvedValue(undefined)} />)

    fireEvent.click(screen.getByText('Reset App'))
    expect(screen.getByText('Reset app and erase all data?')).toBeTruthy()

    const eraseButton = screen.getByRole('button', { name: /erase everything/i }) as HTMLButtonElement
    expect(eraseButton.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('RESET'), { target: { value: 'RESE' } })
    expect(eraseButton.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('RESET'), { target: { value: 'reset' } })
    expect(eraseButton.disabled).toBe(false)

    fireEvent.change(screen.getByPlaceholderText('RESET'), { target: { value: 'RESET' } })
    expect(eraseButton.disabled).toBe(false)
  })

  it('clicking enabled Erase Everything calls onReset once, closes the dialog, and shows the toast', async () => {
    const onReset = vi.fn().mockResolvedValue(undefined)
    render(<ResetAppControl onReset={onReset} />)

    fireEvent.click(screen.getByText('Reset App'))
    fireEvent.change(screen.getByPlaceholderText('RESET'), { target: { value: 'RESET' } })
    fireEvent.click(screen.getByRole('button', { name: /erase everything/i }))

    await waitFor(() => {
      expect(onReset).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('Reset app and erase all data?')).toBeFalsy()
      expect(screen.getByText('App reset. All data wiped.')).toBeTruthy()
    })
  })

  it('Cancel closes the dialog without calling onReset and clears the typed text', () => {
    const onReset = vi.fn().mockResolvedValue(undefined)
    render(<ResetAppControl onReset={onReset} />)

    fireEvent.click(screen.getByText('Reset App'))
    fireEvent.change(screen.getByPlaceholderText('RESET'), { target: { value: 'RESET' } })
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.queryByText('Reset app and erase all data?')).toBeFalsy()
    expect(onReset).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Reset App'))
    expect((screen.getByPlaceholderText('RESET') as HTMLInputElement).value).toBe('')
  })
})
