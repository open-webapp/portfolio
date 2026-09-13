import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { PortfolioPicker } from './PortfolioPicker'
import type { Portfolio } from '../lib/types'

function makePortfolio(overrides: Partial<Portfolio> = {}): Portfolio {
  return {
    id: 'p1',
    name: 'Retirement',
    dbName: 'db-p1',
    createdAt: Date.now(),
    ...overrides,
  }
}

// The create-form input (placeholder "Enter a portfolio name") is always
// present, so the rename input must be found by excluding it.
function getRenameInput(): HTMLInputElement | null {
  const inputs = Array.from(document.querySelectorAll('input.input')) as HTMLInputElement[]
  return inputs.find((el) => el.placeholder !== 'Enter a portfolio name') ?? null
}

function renderPicker(props: Partial<React.ComponentProps<typeof PortfolioPicker>> = {}) {
  const defaults: React.ComponentProps<typeof PortfolioPicker> = {
    portfolios: [],
    onCreate: vi.fn().mockResolvedValue(undefined),
    onRename: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onOpen: vi.fn(),
    ...props,
  }
  return { ...render(<PortfolioPicker {...defaults} />), props: defaults }
}

describe('PortfolioPicker', () => {
  afterEach(() => {
    cleanup()
  })

  describe('list rendering', () => {
    it('renders each portfolio name, an Open button, and a Delete control', () => {
      const portfolios = [
        makePortfolio({ id: 'p1', name: 'Retirement' }),
        makePortfolio({ id: 'p2', name: 'Brokerage' }),
      ]
      renderPicker({ portfolios })

      expect(screen.getByText('Retirement')).toBeTruthy()
      expect(screen.getByText('Brokerage')).toBeTruthy()

      const openButtons = screen.getAllByRole('button', { name: 'Open' })
      expect(openButtons).toHaveLength(2)

      const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
      expect(deleteButtons).toHaveLength(2)
    })

    it('clicking Open calls onOpen with the portfolio id', () => {
      const onOpen = vi.fn()
      const portfolios = [makePortfolio({ id: 'p1', name: 'Retirement' })]
      renderPicker({ portfolios, onOpen })

      fireEvent.click(screen.getByRole('button', { name: 'Open' }))

      expect(onOpen).toHaveBeenCalledWith('p1')
    })
  })

  describe('delete flow', () => {
    it('does not call onDelete when window.confirm returns false', async () => {
      const onDelete = vi.fn()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const portfolios = [makePortfolio({ id: 'p1', name: 'Retirement' })]
      renderPicker({ portfolios, onDelete })

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

      expect(confirmSpy).toHaveBeenCalled()
      expect(onDelete).not.toHaveBeenCalled()
    })

    it('calls onDelete with the correct id when window.confirm returns true', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined)
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const portfolios = [makePortfolio({ id: 'p1', name: 'Retirement' })]
      renderPicker({ portfolios, onDelete })

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(onDelete).toHaveBeenCalledWith('p1')
      })
    })
  })

  describe('create form', () => {
    it('typing a name and clicking Create calls onCreate with the typed name', async () => {
      const onCreate = vi.fn().mockResolvedValue(undefined)
      renderPicker({ onCreate })

      fireEvent.change(screen.getByPlaceholderText('Enter a portfolio name'), {
        target: { value: 'New Portfolio' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledWith('New Portfolio')
      })
    })

    it('shows the error message when onCreate rejects with a duplicate-name error, without throwing', async () => {
      const onCreate = vi.fn().mockRejectedValue(new Error('A portfolio with that name already exists'))
      renderPicker({ onCreate })

      fireEvent.change(screen.getByPlaceholderText('Enter a portfolio name'), {
        target: { value: 'Retirement' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))

      expect(await screen.findByText('A portfolio with that name already exists')).toBeTruthy()
    })
  })

  describe('rename flow', () => {
    it('clicking the portfolio name enters rename mode with an input pre-filled with the current name', () => {
      const portfolios = [makePortfolio({ id: 'p1', name: 'Retirement' })]
      renderPicker({ portfolios })

      fireEvent.click(screen.getByText('Retirement'))

      const input = getRenameInput()
      expect(input).toBeTruthy()
      expect(input!.value).toBe('Retirement')
    })

    it('pressing Enter with a new value calls onRename(id, newName)', async () => {
      const onRename = vi.fn().mockResolvedValue(undefined)
      const portfolios = [makePortfolio({ id: 'p1', name: 'Retirement' })]
      renderPicker({ portfolios, onRename })

      fireEvent.click(screen.getByText('Retirement'))
      const input = getRenameInput()!
      fireEvent.change(input, { target: { value: 'Retirement 2' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => {
        expect(onRename).toHaveBeenCalledWith('p1', 'Retirement 2')
      })
    })

    it('pressing Escape cancels the edit and does not call onRename', () => {
      const onRename = vi.fn()
      const portfolios = [makePortfolio({ id: 'p1', name: 'Retirement' })]
      renderPicker({ portfolios, onRename })

      fireEvent.click(screen.getByText('Retirement'))
      const input = getRenameInput()!
      fireEvent.change(input, { target: { value: 'Something else' } })
      fireEvent.keyDown(input, { key: 'Escape' })

      expect(getRenameInput()).toBeFalsy()
      expect(screen.getByText('Retirement')).toBeTruthy()
      expect(onRename).not.toHaveBeenCalled()
    })

    it('blurring the input with an unchanged name (different case/whitespace) does not call onRename', async () => {
      const onRename = vi.fn()
      const portfolios = [makePortfolio({ id: 'p1', name: 'Retirement' })]
      renderPicker({ portfolios, onRename })

      fireEvent.click(screen.getByText('Retirement'))
      const input = getRenameInput()!
      // Component's commitRename trims and lowercases both sides before comparing,
      // so this counts as "unchanged".
      fireEvent.change(input, { target: { value: '  RETIREMENT  ' } })
      fireEvent.blur(input)

      await waitFor(() => {
        expect(getRenameInput()).toBeFalsy()
      })
      expect(onRename).not.toHaveBeenCalled()
    })
  })
})
