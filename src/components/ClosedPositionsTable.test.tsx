import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ClosedPositionsTable } from './ClosedPositionsTable'
import type { AppState, ClosedPosition } from '../lib/types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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

  it('renders an undo button per row', () => {
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

    // Should have 2 undo buttons (one per row)
    const undoButtons = screen.getAllByTitle('Reopen this position as an import')
    expect(undoButtons).toHaveLength(2)
  })

  it('undo with no matching open position silently restores, no confirm shown', () => {
    const confirmSpy = vi.spyOn(window, 'confirm')

    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        closedDate: '2024-01-15',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 100,
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

    const undoButton = screen.getByTitle('Reopen this position as an import')
    fireEvent.click(undoButton)

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'RESTORE_CLOSED_POSITION',
      closedPositionId: 'cp-1',
    })

    confirmSpy.mockRestore()
  })

  it('undo with exact-lot match and confirm accepted dispatches restore with replaceExistingPositionId', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        closedDate: '2024-01-15',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 100,
        realizedGL: 1500,
        realizedGLBasis: 'transactions',
      },
    ]

    const state: AppState = {
      accounts: [],
      positions: [
        {
          id: 'pos-1',
          accountId: 'acc-1',
          symbol: 'AAPL',
          name: 'Apple Inc',
          assetClass: 'Equity',
          shares: 10,
          avgCost: 100,
          price: 150,
        },
      ],
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

    const undoButton = screen.getByTitle('Reopen this position as an import')
    fireEvent.click(undoButton)

    expect(window.confirm).toHaveBeenCalledWith(
      'An open position already exists for AAPL with the same shares and cost basis. Restore this closed position and replace the existing one?'
    )
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'RESTORE_CLOSED_POSITION',
      closedPositionId: 'cp-1',
      replaceExistingPositionId: 'pos-1',
    })
  })

  it('undo with exact-lot match and confirm declined does not dispatch', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        closedDate: '2024-01-15',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 100,
        realizedGL: 1500,
        realizedGLBasis: 'transactions',
      },
    ]

    const state: AppState = {
      accounts: [],
      positions: [
        {
          id: 'pos-1',
          accountId: 'acc-1',
          symbol: 'AAPL',
          name: 'Apple Inc',
          assetClass: 'Equity',
          shares: 10,
          avgCost: 100,
          price: 150,
        },
      ],
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

    const undoButton = screen.getByTitle('Reopen this position as an import')
    fireEvent.click(undoButton)

    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('undo with partial (same-symbol, different lot) match silently restores as duplicate, no confirm shown', () => {
    const confirmSpy = vi.spyOn(window, 'confirm')

    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        closedDate: '2024-01-15',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 100,
        realizedGL: 1500,
        realizedGLBasis: 'transactions',
      },
    ]

    const state: AppState = {
      accounts: [],
      positions: [
        {
          id: 'pos-1',
          accountId: 'acc-1',
          symbol: 'AAPL',
          name: 'Apple Inc',
          assetClass: 'Equity',
          shares: 25,
          avgCost: 120,
          price: 150,
        },
      ],
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

    const undoButton = screen.getByTitle('Reopen this position as an import')
    fireEvent.click(undoButton)

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'RESTORE_CLOSED_POSITION',
      closedPositionId: 'cp-1',
    })

    confirmSpy.mockRestore()
  })
})
