import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { SettingsPage } from './Settings'
import { initialState } from '../lib/state'
import * as driveModule from '../lib/drive'

// Mock the drive module
vi.mock('../lib/drive', () => ({
  getDriveConnection: vi.fn(),
  connectDrive: vi.fn(),
  disconnectDrive: vi.fn(),
  syncBackup: vi.fn(),
  restoreBackup: vi.fn(),
}))

// Mock window.alert and window.confirm
global.alert = vi.fn()
global.confirm = vi.fn()

const mockDispatch = vi.fn()

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('Not connected state', () => {
    beforeEach(() => {
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(null)
    })

    it('renders "Not connected" state initially with Connect button', async () => {
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      await waitFor(() => {
        const heading = screen.getByRole('heading', { name: 'Google Drive Sync' })
        expect(heading).toBeTruthy()
      })

      const connectButton = screen.getByRole('button', { name: 'Connect Drive' })
      expect(connectButton).toBeTruthy()

      // Should not show Sync, Restore, or Disconnect buttons
      expect(screen.queryByRole('button', { name: /Sync Now/ })).toBeFalsy()
      expect(screen.queryByRole('button', { name: /Restore from Drive/ })).toBeFalsy()
      expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeFalsy()
    })

    it('clicking Connect button calls connectDrive and shows alert', async () => {
      vi.mocked(driveModule.connectDrive).mockResolvedValue({} as any)
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const connectButton = await screen.findByRole('button', { name: 'Connect Drive' })
      fireEvent.click(connectButton)

      await waitFor(() => {
        expect(driveModule.connectDrive).toHaveBeenCalled()
        expect(global.alert).toHaveBeenCalledWith('Connected to Drive')
      })
    })

    it('Connect button shows connecting state while syncing', async () => {
      vi.mocked(driveModule.connectDrive).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({} as any), 100))
      )
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const connectButton = await screen.findByRole('button', { name: 'Connect Drive' })
      fireEvent.click(connectButton)

      expect(screen.getByRole('button', { name: 'Connecting...' })).toBeTruthy()

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Connecting...' })).toBeFalsy()
      })
    })

    it('shows error alert if Connect fails', async () => {
      const error = new Error('Connect error')
      vi.mocked(driveModule.connectDrive).mockRejectedValue(error)
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const connectButton = await screen.findByRole('button', { name: 'Connect Drive' })
      fireEvent.click(connectButton)

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith('Connect failed: Connect error')
      })
    })
  })

  describe('Connected state', () => {
    beforeEach(() => {
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue({ accessToken: 'token' } as any)
    })

    it('renders connected state with Sync Now, Restore from Drive, and Disconnect buttons', async () => {
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Sync Now' })).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Restore from Drive' })).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy()
      })

      // Should not show Connect button
      expect(screen.queryByRole('button', { name: 'Connect Drive' })).toBeFalsy()
    })

    it('clicking Sync Now calls syncBackup with state', async () => {
      vi.mocked(driveModule.syncBackup).mockResolvedValue()
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const syncButton = await screen.findByRole('button', { name: 'Sync Now' })
      fireEvent.click(syncButton)

      await waitFor(() => {
        expect(driveModule.syncBackup).toHaveBeenCalledWith(state)
        expect(global.alert).toHaveBeenCalledWith('Synced to Drive')
      })
    })

    it('Sync Now button shows syncing state', async () => {
      vi.mocked(driveModule.syncBackup).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(), 100))
      )
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const syncButton = await screen.findByRole('button', { name: 'Sync Now' })
      fireEvent.click(syncButton)

      expect(screen.getByRole('button', { name: 'Syncing...' })).toBeTruthy()

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Syncing...' })).toBeFalsy()
      })
    })

    it('shows error alert if Sync fails', async () => {
      const error = new Error('Sync error')
      vi.mocked(driveModule.syncBackup).mockRejectedValue(error)
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const syncButton = await screen.findByRole('button', { name: 'Sync Now' })
      fireEvent.click(syncButton)

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith('Sync failed: Sync error')
      })
    })

    it('Restore from Drive calls restoreBackup and dispatches __SET_STATE', async () => {
      const restoredState = initialState()
      restoredState.accounts = [
        {
          id: '1',
          accountNumber: '123',
          name: 'Test Account',
          taxCategory: 'taxable',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ]

      vi.mocked(driveModule.restoreBackup).mockResolvedValue(restoredState)
      vi.mocked(global.confirm).mockReturnValue(true)
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const restoreButton = await screen.findByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalledWith(
          'Restore will replace all data with the backed-up version. Continue?'
        )
        expect(driveModule.restoreBackup).toHaveBeenCalled()
        expect(mockDispatch).toHaveBeenCalledWith({
          type: '__SET_STATE',
          newState: restoredState,
        })
        expect(global.alert).toHaveBeenCalledWith('Restored from Drive')
      })
    })

    it('Restore is cancelled if confirm is false', async () => {
      vi.mocked(global.confirm).mockReturnValue(false)
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const restoreButton = await screen.findByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalled()
        expect(driveModule.restoreBackup).not.toHaveBeenCalled()
        expect(mockDispatch).not.toHaveBeenCalled()
      })
    })

    it('shows "No backup found" alert if restore returns null', async () => {
      vi.mocked(driveModule.restoreBackup).mockResolvedValue(null)
      vi.mocked(global.confirm).mockReturnValue(true)
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const restoreButton = await screen.findByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith('No backup found on Drive')
      })
    })

    it('Restore button shows restoring state', async () => {
      const restoredState = initialState()
      vi.mocked(driveModule.restoreBackup).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(restoredState), 100))
      )
      vi.mocked(global.confirm).mockReturnValue(true)
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const restoreButton = await screen.findByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      expect(screen.getByRole('button', { name: 'Restoring...' })).toBeTruthy()

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Restoring...' })).toBeFalsy()
      })
    })

    it('shows error alert if Restore fails', async () => {
      const error = new Error('Restore error')
      vi.mocked(driveModule.restoreBackup).mockRejectedValue(error)
      vi.mocked(global.confirm).mockReturnValue(true)
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const restoreButton = await screen.findByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith('Restore failed: Restore error')
      })
    })
  })

  describe('Disconnect functionality', () => {
    beforeEach(() => {
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue({ accessToken: 'token' } as any)
    })

    it('clicking Disconnect calls disconnectDrive and flips UI back to "not connected"', async () => {
      vi.mocked(driveModule.disconnectDrive).mockResolvedValue()
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const disconnectButton = await screen.findByRole('button', { name: 'Disconnect' })
      fireEvent.click(disconnectButton)

      await waitFor(() => {
        expect(driveModule.disconnectDrive).toHaveBeenCalled()
        expect(global.alert).toHaveBeenCalledWith('Disconnected from Drive')
      })

      // After disconnect, should show Connect button again
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Connect Drive' })).toBeTruthy()
      })

      // Should not show Sync, Restore, or Disconnect buttons
      expect(screen.queryByRole('button', { name: /Sync Now/ })).toBeFalsy()
      expect(screen.queryByRole('button', { name: /Restore from Drive/ })).toBeFalsy()
      expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeFalsy()
    })

    it('Disconnect button shows disconnecting state', async () => {
      vi.mocked(driveModule.disconnectDrive).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(), 100))
      )
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const disconnectButton = await screen.findByRole('button', { name: 'Disconnect' })
      fireEvent.click(disconnectButton)

      expect(screen.getByRole('button', { name: 'Disconnecting...' })).toBeTruthy()

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Disconnecting...' })).toBeFalsy()
      })
    })

    it('shows error alert if Disconnect fails', async () => {
      const error = new Error('Disconnect error')
      vi.mocked(driveModule.disconnectDrive).mockRejectedValue(error)
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const disconnectButton = await screen.findByRole('button', { name: 'Disconnect' })
      fireEvent.click(disconnectButton)

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith('Disconnect failed: Disconnect error')
      })
    })
  })

  describe('Accounts section', () => {
    beforeEach(() => {
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(null)
    })

    it('shows empty-state text when accounts is empty', () => {
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const headings = screen.getAllByRole('heading', { name: 'Accounts' })
      expect(headings.length).toBeGreaterThan(0)
      expect(screen.getByText('No accounts yet.')).toBeTruthy()
    })

    it('renders one row per account with current name/taxCategory/retirement values', () => {
      const state = initialState()
      state.accounts = [
        {
          id: 'acc1',
          accountNumber: '123',
          name: 'Main Account',
          taxCategory: 'taxable',
          retirement: false,
          createdAt: '2024-01-01',
        },
        {
          id: 'acc2',
          accountNumber: '456',
          name: 'Retirement IRA',
          taxCategory: 'taxDeferred',
          retirement: true,
          createdAt: '2024-01-01',
        },
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      // Check first account row
      expect(screen.getByText('Main Account')).toBeTruthy()
      // Check retirement checkbox for first account (not checked)
      const checkboxes = screen.getAllByRole('checkbox')
      expect(checkboxes[0].checked).toBe(false)

      // Check second account row
      expect(screen.getByText('Retirement IRA')).toBeTruthy()
      // Check retirement checkbox for second account (checked)
      expect(checkboxes[1].checked).toBe(true)
    })

    it('editing name and blurring dispatches UPDATE_ACCOUNT with the new name', () => {
      const state = initialState()
      state.accounts = [
        {
          id: 'acc1',
          accountNumber: '123',
          name: 'Old Name',
          taxCategory: 'taxable',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const nameCell = screen.getByText('Old Name')
      fireEvent.click(nameCell)

      const input = screen.getByDisplayValue('Old Name') as HTMLInputElement
      expect(input).toBeTruthy()
      expect(input.tagName).toBe('INPUT')

      fireEvent.change(input, { target: { value: 'New Name' } })
      fireEvent.blur(input)

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_ACCOUNT',
        accountId: 'acc1',
        patch: { name: 'New Name' },
      })
    })

    it('pressing Enter in name input dispatches UPDATE_ACCOUNT and exits edit mode', () => {
      const state = initialState()
      state.accounts = [
        {
          id: 'acc1',
          accountNumber: '123',
          name: 'Old Name',
          taxCategory: 'taxable',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const nameCell = screen.getByText('Old Name')
      fireEvent.click(nameCell)

      const input = screen.getByDisplayValue('Old Name') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'New Name' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_ACCOUNT',
        accountId: 'acc1',
        patch: { name: 'New Name' },
      })
    })

    it('changing taxCategory select dispatches UPDATE_ACCOUNT with the new category', () => {
      const state = initialState()
      state.accounts = [
        {
          id: 'acc1',
          accountNumber: '123',
          name: 'Test Account',
          taxCategory: 'taxable',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const selects = screen.getAllByRole('combobox')
      fireEvent.change(selects[0], { target: { value: 'taxDeferred' } })

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_ACCOUNT',
        accountId: 'acc1',
        patch: { taxCategory: 'taxDeferred' },
      })
    })

    it('toggling retirement checkbox dispatches UPDATE_ACCOUNT with the new boolean', () => {
      const state = initialState()
      state.accounts = [
        {
          id: 'acc1',
          accountNumber: '123',
          name: 'Test Account',
          taxCategory: 'taxable',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const checkbox = screen.getAllByRole('checkbox')[0]
      fireEvent.click(checkbox)

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_ACCOUNT',
        accountId: 'acc1',
        patch: { retirement: true },
      })
    })

    it('delete button with confirm false does not dispatch', () => {
      vi.mocked(global.confirm).mockReturnValue(false)
      const state = initialState()
      state.accounts = [
        {
          id: 'acc1',
          accountNumber: '123',
          name: 'Test Account',
          taxCategory: 'taxable',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const deleteButton = screen.getByTitle('Delete this account')
      fireEvent.click(deleteButton)

      expect(global.confirm).toHaveBeenCalledWith(
        'Delete this account? This removes all its positions, closed positions, transactions, and snapshots.'
      )
      expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('delete button with confirm true dispatches DELETE_ACCOUNT with the right accountId', () => {
      vi.mocked(global.confirm).mockReturnValue(true)
      const state = initialState()
      state.accounts = [
        {
          id: 'acc1',
          accountNumber: '123',
          name: 'Test Account',
          taxCategory: 'taxable',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const deleteButton = screen.getByTitle('Delete this account')
      fireEvent.click(deleteButton)

      expect(global.confirm).toHaveBeenCalledWith(
        'Delete this account? This removes all its positions, closed positions, transactions, and snapshots.'
      )
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'DELETE_ACCOUNT',
        accountId: 'acc1',
      })
    })
  })

  describe('Import Sessions section', () => {
    beforeEach(() => {
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(null)
    })

    it('shows empty-state text when importSessions is empty', () => {
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      expect(screen.getByText('No imports yet.')).toBeTruthy()
    })

    it('renders table with one row per import session', () => {
      const state = initialState()
      state.importSessions = [
        {
          id: 'sess1',
          importedAt: '2024-01-15T10:30:00Z',
          kind: 'positions',
          fileName: 'portfolio.csv',
          accountIds: ['acc1'],
          rowCount: 42,
        },
        {
          id: 'sess2',
          importedAt: '2024-01-16T14:45:00Z',
          kind: 'transactions',
          fileName: 'trades.csv',
          accountIds: ['acc1', 'acc2'],
          rowCount: 128,
        },
      ]
      state.accounts = [
        { id: 'acc1', accountNumber: '123', name: 'Main', taxCategory: 'taxable', retirement: false, createdAt: '2024-01-01' },
        { id: 'acc2', accountNumber: '456', name: 'IRA', taxCategory: 'taxDeferred', retirement: true, createdAt: '2024-01-01' },
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const tables = screen.getAllByRole('table')
      expect(tables.length).toBeGreaterThan(0)

      // Check first row
      expect(screen.getByText('2024-01-15T10:30:00Z')).toBeTruthy()
      expect(screen.getByText('positions')).toBeTruthy()
      expect(screen.getByText('portfolio.csv')).toBeTruthy()
      expect(screen.getByText('42')).toBeTruthy()

      // Check second row
      expect(screen.getByText('2024-01-16T14:45:00Z')).toBeTruthy()
      expect(screen.getByText('transactions')).toBeTruthy()
      expect(screen.getByText('trades.csv')).toBeTruthy()
      expect(screen.getByText('128')).toBeTruthy()
    })

    it('resolves account names from accountIds', () => {
      const state = initialState()
      state.importSessions = [
        {
          id: 'sess1',
          importedAt: '2024-01-15T10:30:00Z',
          kind: 'positions',
          fileName: 'portfolio.csv',
          accountIds: ['acc1', 'acc2'],
          rowCount: 50,
        },
      ]
      state.accounts = [
        { id: 'acc1', accountNumber: '123', name: 'Main Account', taxCategory: 'taxable', retirement: false, createdAt: '2024-01-01' },
        { id: 'acc2', accountNumber: '456', name: 'Retirement Account', taxCategory: 'taxDeferred', retirement: true, createdAt: '2024-01-01' },
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      expect(screen.getByText('Main Account, Retirement Account')).toBeTruthy()
    })

    it('delete button with confirm false does not dispatch', () => {
      vi.mocked(global.confirm).mockReturnValue(false)
      const state = initialState()
      state.importSessions = [
        {
          id: 'sess1',
          importedAt: '2024-01-15T10:30:00Z',
          kind: 'positions',
          fileName: 'portfolio.csv',
          accountIds: ['acc1'],
          rowCount: 42,
        },
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const deleteButton = screen.getByTitle('Delete this import session')
      fireEvent.click(deleteButton)

      expect(global.confirm).toHaveBeenCalledWith('Delete this import? This will remove 42 positions/transactions.')
      expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('delete button with confirm true dispatches DELETE_IMPORT_SESSION', () => {
      vi.mocked(global.confirm).mockReturnValue(true)
      const state = initialState()
      state.importSessions = [
        {
          id: 'sess1',
          importedAt: '2024-01-15T10:30:00Z',
          kind: 'positions',
          fileName: 'portfolio.csv',
          accountIds: ['acc1'],
          rowCount: 42,
        },
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const deleteButton = screen.getByTitle('Delete this import session')
      fireEvent.click(deleteButton)

      expect(global.confirm).toHaveBeenCalledWith('Delete this import? This will remove 42 positions/transactions.')
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'DELETE_IMPORT_SESSION',
        sessionId: 'sess1',
      })
    })
  })

  describe('Saved Mappings section', () => {
    beforeEach(() => {
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(null)
    })

    const makeProfile = (overrides: Partial<{
      id: string
      name: string
      kind: 'positions' | 'transactions'
      updatedAt: string
    }>) => ({
      id: 'map1',
      name: 'Test Profile',
      kind: 'positions' as const,
      fieldMap: {
        Ticker: 'symbol',
        Class: 'assetClass',
        Qty: 'shares',
        Cost: 'avgCost',
        Px: 'price',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      ...overrides,
    })

    it('shows empty-state text when mappingProfiles is empty and no table is rendered', () => {
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      expect(screen.getByText('No saved profiles yet.')).toBeTruthy()
      expect(screen.queryByRole('table')).toBeFalsy()
    })

    it('renders one row per profile, ordered by updatedAt descending', () => {
      const state = initialState()
      state.mappingProfiles = [
        makeProfile({ id: 'old', name: 'Oldest Profile', kind: 'positions', updatedAt: '2024-01-01T00:00:00.000Z' }),
        makeProfile({ id: 'mid', name: 'Middle Profile', kind: 'transactions', updatedAt: '2024-01-05T00:00:00.000Z' }),
        makeProfile({ id: 'new', name: 'Newest Profile', kind: 'positions', updatedAt: '2024-01-10T00:00:00.000Z' }),
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      expect(screen.getAllByText('Positions').length).toBe(2)
      expect(screen.getByText('Transactions')).toBeTruthy()

      const rows = screen.getAllByRole('row')
      expect(rows.length).toBe(4) // header + 3 profiles
      const rowTexts = rows.map((r) => r.textContent || '')
      expect(rowTexts[1]).toContain('Newest Profile')
      expect(rowTexts[1]).toContain('2024-01-10T00:00:00.000Z')
      expect(rowTexts[2]).toContain('Middle Profile')
      expect(rowTexts[2]).toContain('Transactions')
      expect(rowTexts[2]).toContain('2024-01-05T00:00:00.000Z')
      expect(rowTexts[3]).toContain('Oldest Profile')
      expect(rowTexts[3]).toContain('2024-01-01T00:00:00.000Z')
    })

    it('renders name, formatted kind, and updated date for each profile', () => {
      const state = initialState()
      state.mappingProfiles = [
        makeProfile({ id: 'pos1', name: 'My Positions', kind: 'positions', updatedAt: '2024-01-02T00:00:00.000Z' }),
        makeProfile({ id: 'tx1', name: 'My Transactions', kind: 'transactions', updatedAt: '2024-01-03T00:00:00.000Z' }),
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      expect(screen.getByText('My Positions')).toBeTruthy()
      expect(screen.getByText('Positions')).toBeTruthy()
      expect(screen.getByText('2024-01-02T00:00:00.000Z')).toBeTruthy()
      expect(screen.getByText('My Transactions')).toBeTruthy()
      expect(screen.getByText('Transactions')).toBeTruthy()
      expect(screen.getByText('2024-01-03T00:00:00.000Z')).toBeTruthy()
    })

    it('clicking the pencil icon opens the modal showing the selected profile', () => {
      const state = initialState()
      state.mappingProfiles = [
        makeProfile({ id: 'pos1', name: 'My Positions', kind: 'positions' }),
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      expect(screen.queryByText('Mapping Profile Editor')).toBeFalsy()

      const editButton = screen.getByTitle('Edit this profile')
      fireEvent.click(editButton)

      expect(screen.getByText('Mapping Profile Editor')).toBeTruthy()
      expect((screen.getByDisplayValue('My Positions') as HTMLInputElement).value).toBe('My Positions')
    })

    it('cancel button closes the modal without dispatching anything', () => {
      const state = initialState()
      state.mappingProfiles = [
        makeProfile({ id: 'pos1', name: 'My Positions', kind: 'positions' }),
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const editButton = screen.getByTitle('Edit this profile')
      fireEvent.click(editButton)
      expect(screen.getByText('Mapping Profile Editor')).toBeTruthy()

      const cancelButton = screen.getByText('Cancel')
      fireEvent.click(cancelButton)

      expect(screen.queryByText('Mapping Profile Editor')).toBeFalsy()
      expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('save button dispatches UPDATE_MAPPING_PROFILE with the edited profile and closes the modal', () => {
      const state = initialState()
      state.mappingProfiles = [
        makeProfile({ id: 'pos1', name: 'My Positions', kind: 'positions' }),
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const editButton = screen.getByTitle('Edit this profile')
      fireEvent.click(editButton)

      const nameInput = screen.getByDisplayValue('My Positions') as HTMLInputElement
      fireEvent.change(nameInput, { target: { value: 'Edited Profile' } })

      fireEvent.click(screen.getByText('Save as profile'))

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UPDATE_MAPPING_PROFILE',
          profileId: 'pos1',
          profile: expect.objectContaining({
            id: 'pos1',
            name: 'Edited Profile',
          }),
        })
      )
      expect(screen.queryByText('Mapping Profile Editor')).toBeFalsy()
    })

    it('trash icon with confirm false does not dispatch', () => {
      vi.mocked(global.confirm).mockReturnValue(false)
      const state = initialState()
      state.mappingProfiles = [
        makeProfile({ id: 'pos1', name: 'My Positions', kind: 'positions' }),
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const deleteButton = screen.getByTitle('Delete this profile')
      fireEvent.click(deleteButton)

      expect(global.confirm).toHaveBeenCalledWith(
        'Delete this saved profile? It will no longer be available for import.'
      )
      expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('trash icon with confirm true dispatches DELETE_MAPPING_PROFILE with the profile id', () => {
      vi.mocked(global.confirm).mockReturnValue(true)
      const state = initialState()
      state.mappingProfiles = [
        makeProfile({ id: 'pos1', name: 'My Positions', kind: 'positions' }),
      ]

      render(<SettingsPage state={state} dispatch={mockDispatch} />)

      const deleteButton = screen.getByTitle('Delete this profile')
      fireEvent.click(deleteButton)

      expect(global.confirm).toHaveBeenCalledWith(
        'Delete this saved profile? It will no longer be available for import.'
      )
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'DELETE_MAPPING_PROFILE',
        profileId: 'pos1',
      })
    })
  })
})
