import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { PortfolioPicker, type PortfolioPickerProps } from './PortfolioPicker'
import type { Portfolio } from '../lib/types'
import type { EncryptedEnvelope } from '../lib/crypto'
import { parseImportFile, ImportMalformedFileError, ImportDecryptError } from '../lib/importExport'
import { DriveDecryptError } from '../lib/drive'

vi.mock('../lib/importExport', () => ({
  parseImportFile: vi.fn(),
  ImportMalformedFileError: class ImportMalformedFileError extends Error {},
  ImportDecryptError: class ImportDecryptError extends Error {},
}))

vi.mock('../lib/drive', () => ({
  DriveDecryptError: class DriveDecryptError extends Error {
    salt: unknown
    envelope: unknown
    constructor(message: string, salt?: unknown, envelope?: unknown) {
      super(message)
      this.name = 'DriveDecryptError'
      this.salt = salt
      this.envelope = envelope
    }
  },
  DriveMalformedBackupError: class DriveMalformedBackupError extends Error {},
}))

const fakeEnvelope: EncryptedEnvelope = {
  version: 1,
  salt: 'c2FsdA==',
  iv: 'aXY=',
  ciphertext: 'Y2lwaGVy',
}

function makePortfolio(overrides: Partial<Portfolio> = {}): Portfolio {
  return {
    id: 'p1',
    name: 'Retirement',
    dbName: 'db1',
    createdAt: Date.now(),
    ...overrides,
  }
}

function renderPicker(overrides: Partial<PortfolioPickerProps> = {}) {
  const props: PortfolioPickerProps = {
    portfolios: [],
    onCreateNew: vi.fn().mockResolvedValue(undefined),
    onRename: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onOpen: vi.fn(),
    onImportFromDriveFolder: vi.fn().mockResolvedValue(undefined),
    onImportFromFile: vi.fn().mockResolvedValue(undefined),
    onListDriveFolders: vi.fn().mockResolvedValue([]),
    isOnline: true,
    ...overrides,
  }
  return { ...render(<PortfolioPicker {...props} />), props }
}

function getFileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('file input not found')
  return input as HTMLInputElement
}

describe('PortfolioPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.confirm = vi.fn().mockReturnValue(true)
  })

  afterEach(() => {
    cleanup()
  })

  describe('existing portfolios list (regression)', () => {
    it('renders existing portfolios and open/delete/rename still work', async () => {
      const portfolio = makePortfolio({ name: 'Retirement' })
      const { props } = renderPicker({ portfolios: [portfolio] })

      expect(screen.getByText('Retirement')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: 'Open' }))
      expect(props.onOpen).toHaveBeenCalledWith('p1')

      fireEvent.click(screen.getByText('Retirement'))
      const renameInput = screen.getByDisplayValue('Retirement') as HTMLInputElement
      fireEvent.change(renameInput, { target: { value: 'New Name' } })
      fireEvent.blur(renameInput)
      await waitFor(() => {
        expect(props.onRename).toHaveBeenCalledWith('p1', 'New Name')
      })

      fireEvent.click(screen.getByTitle('Delete Retirement'))
      await waitFor(() => {
        expect(props.onDelete).toHaveBeenCalledWith('p1')
      })
    })
  })

  describe('file-import panel', () => {
    it('clicking the "Import from file" button triggers the hidden file input', () => {
      const { container } = renderPicker()
      const fileInput = getFileInput(container)
      const clickSpy = vi.spyOn(fileInput, 'click')

      fireEvent.click(screen.getByText('Import from file'))

      expect(clickSpy).toHaveBeenCalled()
    })

    it('picking a non-JSON/garbage file shows an error and does not open the password panel', async () => {
      vi.mocked(parseImportFile).mockImplementation(() => {
        throw new ImportMalformedFileError('bad file')
      })
      const { container } = renderPicker()
      const fileInput = getFileInput(container)
      const file = new File(['not json'], 'garbage.txt', { type: 'text/plain' })

      fireEvent.change(fileInput, { target: { files: [file] } })

      expect(await screen.findByText('This is not a valid backup file.')).toBeTruthy()
      expect(screen.queryByPlaceholderText("Enter the backup's password")).toBeFalsy()
    })

    it('picking a valid envelope file prefills the name and shows a password field', async () => {
      vi.mocked(parseImportFile).mockReturnValue(fakeEnvelope)
      const { container } = renderPicker()
      const fileInput = getFileInput(container)
      const file = new File(['{}'], 'MyBackup.json', { type: 'application/json' })

      fireEvent.change(fileInput, { target: { files: [file] } })

      expect(await screen.findByDisplayValue('MyBackup')).toBeTruthy()
      expect(screen.getByPlaceholderText("Enter the backup's password")).toBeTruthy()
    })

    it('submitting file-import password with a wrong password shows retry text and keeps the panel open', async () => {
      vi.mocked(parseImportFile).mockReturnValue(fakeEnvelope)
      const onImportFromFile = vi.fn().mockRejectedValue(new ImportDecryptError('nope'))
      const { container } = renderPicker({ onImportFromFile })
      const fileInput = getFileInput(container)
      const file = new File(['{}'], 'MyBackup.json', { type: 'application/json' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      const passwordInput = await screen.findByPlaceholderText("Enter the backup's password")
      fireEvent.change(passwordInput, { target: { value: 'wrong' } })
      fireEvent.click(screen.getByRole('button', { name: 'Import' }))

      expect(await screen.findByText('Incorrect password.')).toBeTruthy()
      expect(screen.getByDisplayValue('MyBackup')).toBeTruthy()
      expect(screen.getByPlaceholderText("Enter the backup's password")).toBeTruthy()
    })

    it('submitting file-import password happy path calls onImportFromFile once with (envelope, name, password)', async () => {
      vi.mocked(parseImportFile).mockReturnValue(fakeEnvelope)
      const onImportFromFile = vi.fn().mockResolvedValue(undefined)
      const { container } = renderPicker({ onImportFromFile })
      const fileInput = getFileInput(container)
      const file = new File(['{}'], 'MyBackup.json', { type: 'application/json' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      const passwordInput = await screen.findByPlaceholderText("Enter the backup's password")
      fireEvent.change(passwordInput, { target: { value: 'correct-pw' } })
      fireEvent.click(screen.getByRole('button', { name: 'Import' }))

      await waitFor(() => {
        expect(onImportFromFile).toHaveBeenCalledTimes(1)
        expect(onImportFromFile).toHaveBeenCalledWith(fakeEnvelope, 'MyBackup', 'correct-pw')
      })
    })
  })

  describe('Drive-folder panel', () => {
    it('disables the trigger button and shows offline tooltip when isOnline is false', () => {
      renderPicker({ isOnline: false })
      const button = screen.getByRole('button', { name: 'Load from Google Drive' }) as HTMLButtonElement

      expect(button.disabled).toBe(true)
      expect(button.title).toBe('Connect to the internet to import from Google Drive')
    })

    it('clicking the trigger while online calls onListDriveFolders and excludes case-insensitive local matches', async () => {
      const onListDriveFolders = vi
        .fn()
        .mockResolvedValue([
          { name: 'RETIREMENT', id: 'd1' },
          { name: 'Brokerage', id: 'd2' },
        ])
      renderPicker({
        portfolios: [makePortfolio({ name: 'Retirement' })],
        onListDriveFolders,
      })

      fireEvent.click(screen.getByRole('button', { name: 'Load from Google Drive' }))

      expect(onListDriveFolders).toHaveBeenCalled()
      await screen.findByText('Brokerage')
      expect(screen.queryByText('RETIREMENT')).toBeFalsy()
    })

    it('shows "No portfolios found in Google Drive." when the list is empty', async () => {
      renderPicker({ onListDriveFolders: vi.fn().mockResolvedValue([]) })

      fireEvent.click(screen.getByRole('button', { name: 'Load from Google Drive' }))

      expect(await screen.findByText('No portfolios found in Google Drive.')).toBeTruthy()
    })

    it('shows "All Google Drive portfolios are already in Your Portfolios." when all folders match local portfolios', async () => {
      renderPicker({
        portfolios: [makePortfolio({ name: 'Retirement' })],
        onListDriveFolders: vi.fn().mockResolvedValue([{ name: 'retirement', id: 'd1' }]),
      })

      fireEvent.click(screen.getByRole('button', { name: 'Load from Google Drive' }))

      expect(
        await screen.findByText('All Google Drive portfolios are already in Your Portfolios.')
      ).toBeTruthy()
    })

    it("shows \"Couldn't connect to Google Drive.\" and no rows when onListDriveFolders rejects", async () => {
      renderPicker({ onListDriveFolders: vi.fn().mockRejectedValue(new Error('network')) })

      fireEvent.click(screen.getByRole('button', { name: 'Load from Google Drive' }))

      expect(await screen.findByText("Couldn't connect to Google Drive.")).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Import' })).toBeFalsy()
    })

    it("clicking one row's Import reveals only that row's password field; wrong password shows retry on that row only", async () => {
      const onImportFromDriveFolder = vi
        .fn()
        .mockRejectedValue(new DriveDecryptError('nope', new Uint8Array(), fakeEnvelope))
      renderPicker({
        onListDriveFolders: vi.fn().mockResolvedValue([
          { name: 'Alpha', id: 'd1' },
          { name: 'Beta', id: 'd2' },
        ]),
        onImportFromDriveFolder,
      })

      fireEvent.click(screen.getByRole('button', { name: 'Load from Google Drive' }))
      await screen.findByText('Alpha')

      const importButtons = screen.getAllByRole('button', { name: 'Import' })
      expect(importButtons).toHaveLength(2)
      fireEvent.click(importButtons[0])

      // Only one password field should be revealed.
      expect(screen.getAllByPlaceholderText("Enter the portfolio's password")).toHaveLength(1)
      // Only two Import buttons remain: the open row's submit button and the
      // second row's untouched trigger button (its password field did not open).
      expect(screen.getAllByRole('button', { name: 'Import' })).toHaveLength(2)

      const passwordInput = screen.getByPlaceholderText("Enter the portfolio's password")
      const alphaRow = passwordInput.closest('.card') as HTMLElement
      fireEvent.change(passwordInput, { target: { value: 'wrong' } })
      fireEvent.click(within(alphaRow).getByRole('button', { name: 'Import' }))

      expect(await screen.findByText('Incorrect password.')).toBeTruthy()
      // Second row unaffected: still just its trigger button, no error text near it.
      const betaRow = screen.getByText('Beta').closest('.card') as HTMLElement
      expect(betaRow.querySelector('input[type="password"]')).toBeFalsy()
      expect(betaRow.textContent).not.toContain('Incorrect password.')
    })

    it('happy path calls onImportFromDriveFolder once with (folder, password)', async () => {
      const onImportFromDriveFolder = vi.fn().mockResolvedValue(undefined)
      renderPicker({
        onListDriveFolders: vi.fn().mockResolvedValue([{ name: 'Alpha', id: 'd1' }]),
        onImportFromDriveFolder,
      })

      fireEvent.click(screen.getByRole('button', { name: 'Load from Google Drive' }))
      await screen.findByText('Alpha')
      fireEvent.click(screen.getByRole('button', { name: 'Import' }))

      const passwordInput = screen.getByPlaceholderText("Enter the portfolio's password")
      fireEvent.change(passwordInput, { target: { value: 'correct-pw' } })
      fireEvent.click(screen.getByRole('button', { name: 'Import' }))

      await waitFor(() => {
        expect(onImportFromDriveFolder).toHaveBeenCalledTimes(1)
        expect(onImportFromDriveFolder).toHaveBeenCalledWith({ name: 'Alpha', id: 'd1' }, 'correct-pw')
      })
    })
  })

  describe('Create panel', () => {
    it('clicking Create with a name entered opens the password+confirm panel', () => {
      renderPicker()

      expect(screen.queryByText('New password')).toBeFalsy()
      fireEvent.change(screen.getByPlaceholderText('Enter a portfolio name'), {
        target: { value: 'New Portfolio' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))

      expect(screen.getByText('New password')).toBeTruthy()
      expect(screen.getByText('Confirm password')).toBeTruthy()
    })

    it('short password shows a validation error and does not call onCreateNew; mismatched confirm shows a different error', async () => {
      const onCreateNew = vi.fn()
      renderPicker({ onCreateNew })

      fireEvent.change(screen.getByPlaceholderText('Enter a portfolio name'), {
        target: { value: 'New Portfolio' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))

      fireEvent.change(screen.getByPlaceholderText('Enter a new password'), { target: { value: 'abc' } })
      fireEvent.change(screen.getByPlaceholderText('Re-enter your password'), { target: { value: 'abc' } })
      fireEvent.click(screen.getByRole('button', { name: 'Set password & create' }))

      expect(await screen.findByText('Password must be at least 6 characters')).toBeTruthy()
      expect(onCreateNew).not.toHaveBeenCalled()

      fireEvent.change(screen.getByPlaceholderText('Enter a new password'), {
        target: { value: 'longenough' },
      })
      fireEvent.change(screen.getByPlaceholderText('Re-enter your password'), {
        target: { value: 'different' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Set password & create' }))

      expect(await screen.findByText('Passwords do not match')).toBeTruthy()
      expect(onCreateNew).not.toHaveBeenCalled()
    })

    it('happy path calls onCreateNew once with (name, password)', async () => {
      const onCreateNew = vi.fn().mockResolvedValue(undefined)
      renderPicker({ onCreateNew })

      fireEvent.change(screen.getByPlaceholderText('Enter a portfolio name'), {
        target: { value: 'New Portfolio' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))

      fireEvent.change(screen.getByPlaceholderText('Enter a new password'), {
        target: { value: 'longenough' },
      })
      fireEvent.change(screen.getByPlaceholderText('Re-enter your password'), {
        target: { value: 'longenough' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Set password & create' }))

      await waitFor(() => {
        expect(onCreateNew).toHaveBeenCalledTimes(1)
        expect(onCreateNew).toHaveBeenCalledWith('New Portfolio', 'longenough')
      })
    })

    it('onCreateNew rejecting shows an inline error and keeps the panel open', async () => {
      const onCreateNew = vi.fn().mockRejectedValue(new Error('A portfolio with this name already exists.'))
      renderPicker({ onCreateNew })

      fireEvent.change(screen.getByPlaceholderText('Enter a portfolio name'), {
        target: { value: 'Dup' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))

      fireEvent.change(screen.getByPlaceholderText('Enter a new password'), {
        target: { value: 'longenough' },
      })
      fireEvent.change(screen.getByPlaceholderText('Re-enter your password'), {
        target: { value: 'longenough' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Set password & create' }))

      expect(await screen.findByText('A portfolio with this name already exists.')).toBeTruthy()
      expect(screen.getByPlaceholderText('Enter a new password')).toBeTruthy()
      expect(screen.getByPlaceholderText('Re-enter your password')).toBeTruthy()
    })
  })
})
