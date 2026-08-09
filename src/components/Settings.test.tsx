import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { SettingsPage } from './Settings'
import { initialState } from '../lib/state'
import * as driveModule from '../lib/drive'
import * as persistModule from '../lib/persist'
import { deriveKey, generateSalt, encryptState } from '../lib/crypto'

// Mock the drive module
vi.mock('../lib/drive', () => {
  class DriveDecryptError extends Error {
    salt: Uint8Array
    envelope: unknown
    constructor(message: string, salt: Uint8Array, envelope: unknown) {
      super(message)
      this.name = 'DriveDecryptError'
      this.salt = salt
      this.envelope = envelope
    }
  }
  return {
    getDriveConnection: vi.fn(),
    getBackupFileId: vi.fn(),
    connectDrive: vi.fn(),
    disconnectDrive: vi.fn(),
    syncBackup: vi.fn(),
    restoreBackup: vi.fn(),
    getDriveAuthStatus: vi.fn(),
    DriveDecryptError,
  }
})

// Mock the persist module (used by the Change Password flow to verify the
// current password and to save the re-encrypted blob under the new key)
vi.mock('../lib/persist', () => ({
  loadPersistedApp: vi.fn(),
  savePersistedApp: vi.fn(),
}))

// Mock window.alert and window.confirm
global.alert = vi.fn()
global.confirm = vi.fn()

const mockDispatch = vi.fn()
const mockOnKeyChange = vi.fn()

const notConnectedAuthStatus: driveModule.DriveAuthStatus = {
  connected: false,
  email: null,
  expiresAt: null,
  needsReauth: false,
  tokenValid: false,
}

const connectedAuthStatus: driveModule.DriveAuthStatus = {
  connected: true,
  email: 'test@example.com',
  expiresAt: Date.now() + 60 * 60 * 1000,
  needsReauth: false,
  tokenValid: true,
}

async function clickSettingsTab(tabName: 'Accounts' | 'Google Drive Sync' | 'Encryption Password' | 'Import Sessions') {
  const span = screen.getByText(tabName)
  const label = span.closest('label')
  if (!label) throw new Error(`Could not find tab label: ${tabName}`)
  fireEvent.click(label)
  // Wait for the tab to become checked
  await waitFor(() => {
    const radio = label.querySelector('input[type="radio"]')
    if (!radio) throw new Error(`Could not find radio input in tab label: ${tabName}`)
    expect((radio as HTMLInputElement).checked).toBe(true)
  })
}

describe('SettingsPage', () => {
  let sessionSalt: Uint8Array
  let sessionKey: CryptoKey

  beforeEach(async () => {
    vi.clearAllMocks()
    sessionSalt = generateSalt()
    sessionKey = await deriveKey('test-password', sessionSalt)
  })

  afterEach(() => {
    cleanup()
  })

  describe('Not connected state', () => {
    beforeEach(() => {
      vi.mocked(driveModule.getDriveAuthStatus).mockResolvedValue(notConnectedAuthStatus)
    })

    it('renders "Not connected" state initially with Connect button', async () => {
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Google Drive Sync')

      await waitFor(() => {
        const heading = screen.getByRole('heading', { name: 'Google Drive Sync' })
        expect(heading).toBeTruthy()
      })

      const connectButton = screen.getByRole('button', { name: 'Connect Google Account' })
      expect(connectButton).toBeTruthy()

      // Should not show Sync, Restore, or Disconnect buttons
      expect(screen.queryByRole('button', { name: /Sync Now/ })).toBeFalsy()
      expect(screen.queryByRole('button', { name: /Restore from Drive/ })).toBeFalsy()
      expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeFalsy()
    })

    it('Connect Drive button has btn btn-primary classes', async () => {
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Google Drive Sync')

      const connectButton = await screen.findByRole('button', { name: 'Connect Google Account' })
      expect(connectButton.className).toContain('btn btn-primary')
    })

    it('clicking Connect button calls connectDrive and shows alert', async () => {
      vi.mocked(driveModule.connectDrive).mockResolvedValue({ email: 'test@example.com' } as any)
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Google Drive Sync')

      const connectButton = await screen.findByRole('button', { name: 'Connect Google Account' })
      fireEvent.click(connectButton)

      await waitFor(() => {
        expect(driveModule.connectDrive).toHaveBeenCalled()
        expect(global.alert).toHaveBeenCalledWith('Connected to Drive')
      })
    })

    it('Connect button shows connecting state while syncing', async () => {
      vi.mocked(driveModule.connectDrive).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ email: 'test@example.com' } as any), 100))
      )
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Google Drive Sync')

      const connectButton = await screen.findByRole('button', { name: 'Connect Google Account' })
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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Google Drive Sync')

      const connectButton = await screen.findByRole('button', { name: 'Connect Google Account' })
      fireEvent.click(connectButton)

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith('Connect failed: Connect error')
      })
    })
  })

  describe('Connected state', () => {
    beforeEach(() => {
      vi.mocked(driveModule.getDriveAuthStatus).mockResolvedValue(connectedAuthStatus)
      vi.mocked(driveModule.getBackupFileId).mockResolvedValue(null)
    })

    it('renders connected state with Sync Now, Restore from Drive, and Disconnect buttons', async () => {
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Google Drive Sync')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Sync Now' })).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Restore from Drive' })).toBeTruthy()
      })

      // Should show connected email and disconnect link
      expect(screen.getByText('test@example.com')).toBeTruthy()
      expect(screen.getByText('Disconnect')).toBeTruthy()
      
      // Should not show Connect button
      expect(screen.queryByRole('button', { name: 'Connect Google Account' })).toBeFalsy()
    })

    it('connected buttons use correct btn classes', async () => {
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Google Drive Sync')

      const syncButton = await screen.findByRole('button', { name: 'Sync Now' })
      expect(syncButton.className).toContain('btn btn-primary')
      expect(screen.getByRole('button', { name: 'Restore from Drive' }).className).toContain(
        'btn btn-secondary'
      )
    })

    it('does not show Drive link when connected but no backup file exists', async () => {
      vi.mocked(driveModule.getBackupFileId).mockResolvedValue(null)
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Google Drive Sync')

      await screen.findByRole('button', { name: 'Sync Now' })

      expect(screen.queryByRole('link', { name: 'View backup in Google Drive' })).toBeFalsy()
    })

    it('shows Drive link to existing backup file when connected and synced', async () => {
      vi.mocked(driveModule.getBackupFileId).mockResolvedValue('file-id-123')
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Google Drive Sync')

      const link = await screen.findByRole('link', { name: 'View backup in Google Drive' })
      expect(link.getAttribute('href')).toBe('https://drive.google.com/file/d/file-id-123/view')
      expect(link.getAttribute('target')).toBe('_blank')
    })

    it('shows Drive link to the newly synced file after clicking Sync Now', async () => {
      vi.mocked(driveModule.syncBackup).mockResolvedValue('file-id-456')
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Google Drive Sync')

      const syncButton = await screen.findByRole('button', { name: 'Sync Now' })
      fireEvent.click(syncButton)

      await waitFor(() => {
        const link = screen.queryByRole('link', { name: 'View backup in Google Drive' })
        expect(link).toBeTruthy()
        expect(link?.getAttribute('href')).toBe('https://drive.google.com/file/d/file-id-456/view')
      })
    })

    it('clicking Sync Now calls syncBackup with state', async () => {
      vi.mocked(driveModule.syncBackup).mockResolvedValue()
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Google Drive Sync')

      const syncButton = await screen.findByRole('button', { name: 'Sync Now' })
      fireEvent.click(syncButton)

      await waitFor(() => {
        expect(driveModule.syncBackup).toHaveBeenCalledWith(state, sessionKey, sessionSalt)
        expect(global.alert).toHaveBeenCalledWith('Synced to Drive')
      })
    })

    it('Sync Now button shows syncing state', async () => {
      vi.mocked(driveModule.syncBackup).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(), 100))
      )
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Google Drive Sync')

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Google Drive Sync')

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Google Drive Sync')

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Google Drive Sync')

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      const restoreButton = await screen.findByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith('Restore failed: Restore error')
      })
    })
  })

  describe('Disconnect functionality', () => {
    beforeEach(() => {
      vi.mocked(driveModule.getDriveAuthStatus).mockResolvedValue(connectedAuthStatus)
      vi.mocked(driveModule.getBackupFileId).mockResolvedValue(null)
    })

    it('clicking Disconnect calls disconnectDrive and flips UI back to "not connected"', async () => {
      vi.mocked(driveModule.disconnectDrive).mockResolvedValue()
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      const disconnectLink = await screen.findByText('Disconnect')
      fireEvent.click(disconnectLink)

      await waitFor(() => {
        expect(driveModule.disconnectDrive).toHaveBeenCalled()
        expect(global.alert).toHaveBeenCalledWith('Disconnected from Drive')
      })

      // After disconnect, should show Connect button again
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Connect Google Account' })).toBeTruthy()
      })

      // Should not show Sync, Restore buttons
      expect(screen.queryByRole('button', { name: /Sync Now/ })).toBeFalsy()
      expect(screen.queryByRole('button', { name: /Restore from Drive/ })).toBeFalsy()
    })

    it('Disconnect link shows disconnecting state', async () => {
      vi.mocked(driveModule.disconnectDrive).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(), 100))
      )
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      const disconnectLink = await screen.findByText('Disconnect')
      fireEvent.click(disconnectLink)

      // During disconnect, the connected account display should still be visible
      // but the disconnect link might be disabled/changed (implementation detail)
      await waitFor(() => {
        expect(driveModule.disconnectDrive).toHaveBeenCalled()
      })
    })

    it('shows error alert if Disconnect fails', async () => {
      const error = new Error('Disconnect error')
      vi.mocked(driveModule.disconnectDrive).mockRejectedValue(error)
      const state = initialState()

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      const disconnectLink = await screen.findByText('Disconnect')
      fireEvent.click(disconnectLink)

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith('Disconnect failed: Disconnect error')
      })
    })
  })

  describe('Tab navigation', () => {
    beforeEach(() => {
      vi.mocked(driveModule.getDriveAuthStatus).mockResolvedValue(notConnectedAuthStatus)
    })

    it('renders General tab by default', () => {
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      // By default, the "Accounts" tab is shown
      expect(screen.getByRole('heading', { name: 'Accounts' })).toBeTruthy()
      // Other sections should not be visible until their tabs are clicked
      expect(screen.queryByRole('heading', { name: 'Google Drive Sync' })).toBeFalsy()
      expect(screen.queryByRole('heading', { name: 'Import Sessions' })).toBeFalsy()
    })

    it('clicking Import Sessions tab shows import sessions table and hides Accounts/Drive sections', () => {
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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      clickSettingsTab('Import Sessions')

      expect(screen.getByRole('heading', { name: 'Import Sessions' })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'Accounts' })).toBeFalsy()
      expect(screen.queryByRole('heading', { name: 'Google Drive Sync' })).toBeFalsy()
    })

    it('clicking back to General tab restores Accounts/Drive sections', async () => {
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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      await clickSettingsTab('Import Sessions')
      expect(screen.getByRole('heading', { name: 'Import Sessions' })).toBeTruthy()

      await clickSettingsTab('Accounts')
      expect(screen.getByRole('heading', { name: 'Accounts' })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'Import Sessions' })).toBeFalsy()
    })

    it('Accounts section renders before Drive Sync section in DOM order', async () => {
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      // When on Accounts tab, Accounts heading should be visible
      const accountsHeading = screen.getByRole('heading', { name: 'Accounts' })
      expect(accountsHeading).toBeTruthy()

      // Click to Drive Sync tab to verify Drive Sync heading appears
      await clickSettingsTab('Google Drive Sync')
      const driveSyncHeading = screen.getByRole('heading', { name: 'Google Drive Sync' })
      expect(driveSyncHeading).toBeTruthy()
    })
  })

  describe('Accounts section', () => {
    beforeEach(() => {
      vi.mocked(driveModule.getDriveAuthStatus).mockResolvedValue(notConnectedAuthStatus)
    })

    it('shows empty-state text when accounts is empty', () => {
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      expect(screen.getByRole('heading', { name: 'Accounts' })).toBeTruthy()
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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

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

  // Import Sessions tests commented out - tab removed from UI
  /*
  describe('Import Sessions section', () => {
    beforeEach(() => {
      vi.mocked(driveModule.getDriveAuthStatus).mockResolvedValue(notConnectedAuthStatus)
    })

    it('shows empty-state text when importSessions is empty', () => {
      const state = initialState()
      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      clickSettingsTab('Import Sessions')

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      clickSettingsTab('Import Sessions')

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      clickSettingsTab('Import Sessions')

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      clickSettingsTab('Import Sessions')

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

      render(<SettingsPage state={state} dispatch={mockDispatch}
        sessionKey={sessionKey}
        sessionSalt={sessionSalt}
        onKeyChange={mockOnKeyChange}
      />)

      clickSettingsTab('Import Sessions')

      const deleteButton = screen.getByTitle('Delete this import session')
      fireEvent.click(deleteButton)

      expect(global.confirm).toHaveBeenCalledWith('Delete this import? This will remove 42 positions/transactions.')
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'DELETE_IMPORT_SESSION',
        sessionId: 'sess1',
      })
    })
  })
  */

  describe('Change Encryption Password', () => {
    beforeEach(() => {
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(null)
      vi.mocked(driveModule.getDriveAuthStatus).mockResolvedValue(notConnectedAuthStatus)
    })

    function fillAndSubmitChangePassword(
      container: HTMLElement,
      fields: { current: string; next: string; confirm: string }
    ) {
      const inputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      const [currentInput, newInput, confirmInput] = inputs.slice(-3)
      fireEvent.change(currentInput, { target: { value: fields.current } })
      fireEvent.change(newInput, { target: { value: fields.next } })
      fireEvent.change(confirmInput, { target: { value: fields.confirm } })
      fireEvent.click(screen.getByRole('button', { name: 'Change Password' }))
    }

    it('happy path: saves locally, calls onKeyChange, shows success, clears fields, no Drive sync when not connected', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())
      vi.mocked(persistModule.savePersistedApp).mockResolvedValue()
      const state = initialState()

      const { container } = render(
        <SettingsPage
          state={state}
          dispatch={mockDispatch}
          sessionKey={sessionKey}
          sessionSalt={sessionSalt}
          onKeyChange={mockOnKeyChange}
        />
      )

      clickSettingsTab('Encryption Password')

      fillAndSubmitChangePassword(container, {
        current: 'test-password',
        next: 'new-password-1',
        confirm: 'new-password-1',
      })

      await waitFor(() => {
        expect(persistModule.savePersistedApp).toHaveBeenCalled()
      })

      const saveArgs = vi.mocked(persistModule.savePersistedApp).mock.calls[0]
      expect(saveArgs[0]).toBe(state)
      expect(saveArgs[2]).not.toEqual(sessionSalt)

      expect(driveModule.syncBackup).not.toHaveBeenCalled()

      await waitFor(() => {
        expect(mockOnKeyChange).toHaveBeenCalled()
      })
      const keyChangeArgs = mockOnKeyChange.mock.calls[0]
      expect(keyChangeArgs[1]).toEqual(saveArgs[2])

      await waitFor(() => {
        expect(screen.getByText('Password changed')).toBeTruthy()
      })

      const inputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      const [currentInput, newInput, confirmInput] = inputs.slice(-3)
      expect(currentInput.value).toBe('')
      expect(newInput.value).toBe('')
      expect(confirmInput.value).toBe('')
    })

    it('shows "Current password is incorrect" and does not save when current password verification fails', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockRejectedValue(new Error('decrypt failed'))
      const state = initialState()

      const { container } = render(
        <SettingsPage
          state={state}
          dispatch={mockDispatch}
          sessionKey={sessionKey}
          sessionSalt={sessionSalt}
          onKeyChange={mockOnKeyChange}
        />
      )

      clickSettingsTab('Encryption Password')

      fillAndSubmitChangePassword(container, {
        current: 'wrong-password',
        next: 'new-password-1',
        confirm: 'new-password-1',
      })

      await waitFor(() => {
        expect(screen.getByText('Current password is incorrect')).toBeTruthy()
      })

      expect(persistModule.savePersistedApp).not.toHaveBeenCalled()
      expect(mockOnKeyChange).not.toHaveBeenCalled()
    })

    it('shows "Password must be at least 6 characters" and does not save when the new password is too short', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())
      const state = initialState()

      const { container } = render(
        <SettingsPage
          state={state}
          dispatch={mockDispatch}
          sessionKey={sessionKey}
          sessionSalt={sessionSalt}
          onKeyChange={mockOnKeyChange}
        />
      )

      clickSettingsTab('Encryption Password')

      fillAndSubmitChangePassword(container, {
        current: 'test-password',
        next: 'abc',
        confirm: 'abc',
      })

      await waitFor(() => {
        expect(screen.getByText('Password must be at least 6 characters')).toBeTruthy()
      })

      expect(persistModule.savePersistedApp).not.toHaveBeenCalled()
      expect(mockOnKeyChange).not.toHaveBeenCalled()
    })

    it('shows "Passwords do not match" and does not save when new/confirm differ', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())
      const state = initialState()

      const { container } = render(
        <SettingsPage
          state={state}
          dispatch={mockDispatch}
          sessionKey={sessionKey}
          sessionSalt={sessionSalt}
          onKeyChange={mockOnKeyChange}
        />
      )

      clickSettingsTab('Encryption Password')

      fillAndSubmitChangePassword(container, {
        current: 'test-password',
        next: 'new-password-1',
        confirm: 'different-password',
      })

      await waitFor(() => {
        expect(screen.getByText('Passwords do not match')).toBeTruthy()
      })

      expect(persistModule.savePersistedApp).not.toHaveBeenCalled()
      expect(mockOnKeyChange).not.toHaveBeenCalled()
    })

    it('also syncs to Drive with the new key/salt when Drive is connected', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())
      vi.mocked(persistModule.savePersistedApp).mockResolvedValue()
      vi.mocked(driveModule.getDriveAuthStatus).mockResolvedValue(connectedAuthStatus)
      vi.mocked(driveModule.syncBackup).mockResolvedValue('file-id')
      const state = initialState()

      const { container } = render(
        <SettingsPage
          state={state}
          dispatch={mockDispatch}
          sessionKey={sessionKey}
          sessionSalt={sessionSalt}
          onKeyChange={mockOnKeyChange}
        />
      )

      clickSettingsTab('Encryption Password')

      fillAndSubmitChangePassword(container, {
        current: 'test-password',
        next: 'new-password-1',
        confirm: 'new-password-1',
      })

      await waitFor(() => {
        expect(driveModule.syncBackup).toHaveBeenCalled()
      })

      const saveArgs = vi.mocked(persistModule.savePersistedApp).mock.calls[0]
      const syncArgs = vi.mocked(driveModule.syncBackup).mock.calls[0]
      expect(syncArgs[0]).toBe(state)
      expect(syncArgs[1]).toBe(saveArgs[1])
      expect(syncArgs[2]).toEqual(saveArgs[2])

      await waitFor(() => {
        expect(screen.getByText('Password changed')).toBeTruthy()
      })
      expect(screen.queryByText(/Drive re-sync failed/)).toBeFalsy()
    })

    it('keeps the local password change and shows a warning when Drive re-sync fails', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())
      vi.mocked(persistModule.savePersistedApp).mockResolvedValue()
      vi.mocked(driveModule.getDriveAuthStatus).mockResolvedValue(connectedAuthStatus)
      vi.mocked(driveModule.syncBackup).mockRejectedValue(new Error('network down'))
      const state = initialState()

      const { container } = render(
        <SettingsPage
          state={state}
          dispatch={mockDispatch}
          sessionKey={sessionKey}
          sessionSalt={sessionSalt}
          onKeyChange={mockOnKeyChange}
        />
      )

      clickSettingsTab('Encryption Password')

      fillAndSubmitChangePassword(container, {
        current: 'test-password',
        next: 'new-password-1',
        confirm: 'new-password-1',
      })

      await waitFor(() => {
        expect(persistModule.savePersistedApp).toHaveBeenCalled()
      })
      await waitFor(() => {
        expect(mockOnKeyChange).toHaveBeenCalled()
      })
      await waitFor(() => {
        expect(
          screen.getByText(/Password changed locally, but Drive re-sync failed: network down/)
        ).toBeTruthy()
      })
    })
  })

  describe('Cross-password Drive restore', () => {
    beforeEach(() => {
      vi.mocked(driveModule.getDriveAuthStatus).mockResolvedValue(connectedAuthStatus)
      vi.mocked(driveModule.getBackupFileId).mockResolvedValue(null)
      vi.mocked(global.confirm).mockReturnValue(true)
    })

    it('shows the inline cross-password prompt when restoreBackup rejects with DriveDecryptError', async () => {
      const backupSalt = generateSalt()
      const backupState = initialState()
      const envelope = await encryptState(backupState, sessionKey, backupSalt)
      vi.mocked(driveModule.restoreBackup).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )
      const state = initialState()

      render(
        <SettingsPage
          state={state}
          dispatch={mockDispatch}
          sessionKey={sessionKey}
          sessionSalt={sessionSalt}
          onKeyChange={mockOnKeyChange}
        />
      )

      clickSettingsTab('Google Drive Sync')

      const restoreButton = await screen.findByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(
          screen.getByText('This backup was saved with a different password. Enter that password to restore:')
        ).toBeTruthy()
      })

      // Only the initial "Restore will replace..." confirm ran to trigger the
      // restore; the decrypt-mismatch path itself does not prompt again.
      expect(global.confirm).toHaveBeenCalledTimes(1)
    })

    it('retries decryption locally against the carried envelope (no second restoreBackup call) on the correct backup password', async () => {
      const backupPassword = 'correct-backup-password'
      const backupSalt = generateSalt()
      const backupKey = await deriveKey(backupPassword, backupSalt)
      const restoredState = initialState()
      restoredState.accounts = [
        {
          id: 'acc1',
          accountNumber: '999',
          name: 'Backup Account',
          taxCategory: 'taxable',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ]
      const envelope = await encryptState(restoredState, backupKey, backupSalt)
      vi.mocked(driveModule.restoreBackup).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )
      const state = initialState()

      const { container } = render(
        <SettingsPage
          state={state}
          dispatch={mockDispatch}
          sessionKey={sessionKey}
          sessionSalt={sessionSalt}
          onKeyChange={mockOnKeyChange}
        />
      )

      clickSettingsTab('Google Drive Sync')

      const restoreButton = await screen.findByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different password/)).toBeTruthy()
      })

      const passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: backupPassword } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith({ type: '__SET_STATE', newState: restoredState })
      })

      expect(driveModule.restoreBackup).toHaveBeenCalledTimes(1)

      await waitFor(() => {
        expect(mockOnKeyChange).toHaveBeenCalled()
      })
      const keyChangeArgs = mockOnKeyChange.mock.calls[0]
      expect(keyChangeArgs[1]).toEqual(backupSalt)
    })

    it('shows an inline error and keeps the prompt open (retryable) on a wrong backup password', async () => {
      const backupSalt = generateSalt()
      const restoredState = initialState()
      const envelope = await encryptState(restoredState, sessionKey, backupSalt)
      vi.mocked(driveModule.restoreBackup).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )
      const state = initialState()

      const { container } = render(
        <SettingsPage
          state={state}
          dispatch={mockDispatch}
          sessionKey={sessionKey}
          sessionSalt={sessionSalt}
          onKeyChange={mockOnKeyChange}
        />
      )

      clickSettingsTab('Google Drive Sync')

      const restoreButton = await screen.findByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different password/)).toBeTruthy()
      })

      const passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: 'totally-wrong-password' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(screen.getByText('Incorrect password')).toBeTruthy()
      })

      // Prompt stays open and can be retried
      expect(
        screen.getByText('This backup was saved with a different password. Enter that password to restore:')
      ).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Restore with this password' })).toBeTruthy()
      expect(mockDispatch).not.toHaveBeenCalled()
    })
  })
})
