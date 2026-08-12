import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ClosedPositionsTable } from './ClosedPositionsTable'
import type { AppState, ClosedPosition } from '../lib/types'

afterEach(cleanup)

describe('ClosedPositionsTable', () => {
  let mockDispatch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockDispatch = vi.fn()
  })

  it('renders a trash-icon delete button per row', () => {
    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        closedDate: '2024-01-15',
        assetClass: 'Equity',
        realizedGL: 1500,
        realizedGLBasis: 'transactions',
      },
      {
        id: 'cp-2',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft Corp',
        closedDate: '2024-02-20',
        assetClass: 'Equity',
        realizedGL: -500,
        realizedGLBasis: 'transactions',
      },
    ]

    const state: AppState = {
      accounts: [],
      positions: [],
      closedPositions,
      transactions: [],
      snapshots: [],
      category: 'all',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
    }

    render(<ClosedPositionsTable state={state} dispatch={mockDispatch} />)

    // Should have 2 delete buttons (one per row)
    const buttons = screen.getAllByTitle('Delete this closed position')
    expect(buttons).toHaveLength(2)
  })

  it('calls window.confirm with the right message when delete button is clicked', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        closedDate: '2024-01-15',
        assetClass: 'Equity',
        realizedGL: 1500,
        realizedGLBasis: 'transactions',
      },
    ]

    const state: AppState = {
      accounts: [],
      positions: [],
      closedPositions,
      transactions: [],
      snapshots: [],
      category: 'all',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
    }

    render(<ClosedPositionsTable state={state} dispatch={mockDispatch} />)

    const deleteButton = screen.getByTitle('Delete this closed position')
    fireEvent.click(deleteButton)

    expect(confirmSpy).toHaveBeenCalledWith(
      'Delete this closed position? This permanently discards its realized G/L history.'
    )

    confirmSpy.mockRestore()
  })

  it('dispatches DELETE_CLOSED_POSITION with the correct id when confirm returns true', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-123',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        closedDate: '2024-01-15',
        assetClass: 'Equity',
        realizedGL: 1500,
        realizedGLBasis: 'transactions',
      },
    ]

    const state: AppState = {
      accounts: [],
      positions: [],
      closedPositions,
      transactions: [],
      snapshots: [],
      category: 'all',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
    }

    render(<ClosedPositionsTable state={state} dispatch={mockDispatch} />)

    const deleteButton = screen.getByTitle('Delete this closed position')
    fireEvent.click(deleteButton)

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'DELETE_CLOSED_POSITION',
      id: 'cp-123',
    })
  })

  it('does not dispatch when confirm returns false', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-456',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft Corp',
        closedDate: '2024-02-20',
        assetClass: 'Equity',
        realizedGL: -500,
        realizedGLBasis: 'transactions',
      },
    ]

    const state: AppState = {
      accounts: [],
      positions: [],
      closedPositions,
      transactions: [],
      snapshots: [],
      category: 'all',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
    }

    render(<ClosedPositionsTable state={state} dispatch={mockDispatch} />)

    const deleteButton = screen.getByTitle('Delete this closed position')
    fireEvent.click(deleteButton)

    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('dispatches only for the specific row when delete is clicked', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-first',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        closedDate: '2024-01-15',
        assetClass: 'Equity',
        realizedGL: 1500,
        realizedGLBasis: 'transactions',
      },
      {
        id: 'cp-second',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft Corp',
        closedDate: '2024-02-20',
        assetClass: 'Equity',
        realizedGL: -500,
        realizedGLBasis: 'transactions',
      },
    ]

    const state: AppState = {
      accounts: [],
      positions: [],
      closedPositions,
      transactions: [],
      snapshots: [],
      category: 'all',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
    }

    render(<ClosedPositionsTable state={state} dispatch={mockDispatch} />)

    const deleteButtons = screen.getAllByTitle('Delete this closed position')
    fireEvent.click(deleteButtons[1]) // Click the second button

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'DELETE_CLOSED_POSITION',
      id: 'cp-second',
    })
  })

  it('renders an undo button per row when onUndoClick is provided', () => {
    const mockUndoClick = vi.fn()
    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        closedDate: '2024-01-15',
        assetClass: 'Equity',
        realizedGL: 1500,
        realizedGLBasis: 'transactions',
      },
      {
        id: 'cp-2',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft Corp',
        closedDate: '2024-02-20',
        assetClass: 'Equity',
        realizedGL: -500,
        realizedGLBasis: 'transactions',
      },
    ]

    const state: AppState = {
      accounts: [],
      positions: [],
      closedPositions,
      transactions: [],
      snapshots: [],
      category: 'all',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
    }

    render(<ClosedPositionsTable state={state} dispatch={mockDispatch} onUndoClick={mockUndoClick} />)

    // Should have 2 undo buttons (one per row)
    const undoButtons = screen.getAllByTitle('Reopen this position as an import')
    expect(undoButtons).toHaveLength(2)
  })

  it('calls onUndoClick with the correct closed position when undo button is clicked', () => {
    const mockUndoClick = vi.fn()
    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        closedDate: '2024-01-15',
        assetClass: 'Equity',
        realizedGL: 1500,
        realizedGLBasis: 'transactions',
      },
    ]

    const state: AppState = {
      accounts: [],
      positions: [],
      closedPositions,
      transactions: [],
      snapshots: [],
      category: 'all',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
    }

    render(<ClosedPositionsTable state={state} dispatch={mockDispatch} onUndoClick={mockUndoClick} />)

    const undoButton = screen.getByTitle('Reopen this position as an import')
    fireEvent.click(undoButton)

    expect(mockUndoClick).toHaveBeenCalledWith(closedPositions[0])
  })

  it('calls onUndoClick with the correct closed position for specific row when undo is clicked', () => {
    const mockUndoClick = vi.fn()
    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-first',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        closedDate: '2024-01-15',
        assetClass: 'Equity',
        realizedGL: 1500,
        realizedGLBasis: 'transactions',
      },
      {
        id: 'cp-second',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft Corp',
        closedDate: '2024-02-20',
        assetClass: 'Equity',
        realizedGL: -500,
        realizedGLBasis: 'transactions',
      },
    ]

    const state: AppState = {
      accounts: [],
      positions: [],
      closedPositions,
      transactions: [],
      snapshots: [],
      category: 'all',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
    }

    render(<ClosedPositionsTable state={state} dispatch={mockDispatch} onUndoClick={mockUndoClick} />)

    const undoButtons = screen.getAllByTitle('Reopen this position as an import')
    fireEvent.click(undoButtons[1]) // Click the second undo button

    expect(mockUndoClick).toHaveBeenCalledWith(closedPositions[1])
  })
})
