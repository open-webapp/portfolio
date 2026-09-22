import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { PortfolioPicker, type PortfolioPickerProps } from './PortfolioPicker'
import type { Portfolio } from '../lib/types'
import type { EncryptedEnvelope } from '../lib/crypto'
import {
  downloadJsonAsFile,
  parseCategoryMappingImportFile,
  parseImportFile,
  ImportMalformedFileError,
  ImportDecryptError,
} from '../lib/importExport'
import { drive, DriveDecryptError, DriveMalformedBackupError, getPickerDriveAuth } from '../lib/drive'
import { pullGlobalCategoriesFromDrive } from '../lib/categoryDrive'
import {
  getSharedCategoryDriveFileId,
  loadGlobalCategoryState,
  saveGlobalCategoryState,
  setSharedCategoryDriveFileId,
} from '../lib/categoryPersist'
import { mergeCategoryState } from '../lib/categoryMerge'

vi.mock('../lib/importExport', () => ({
  downloadJsonAsFile: vi.fn(),
  parseCategoryMappingImportFile: vi.fn(),
  parseImportFile: vi.fn(),
  ImportMalformedFileError: class ImportMalformedFileError extends Error {},
  ImportDecryptError: class ImportDecryptError extends Error {},
}))

vi.mock('../lib/drive', () => ({
  drive: {
    project: vi.fn(),
  },
  getPickerDriveAuth: vi.fn(),
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

vi.mock('../lib/categoryDrive', () => ({
  pullGlobalCategoriesFromDrive: vi.fn(),
}))

vi.mock('../lib/categoryPersist', () => ({
  loadGlobalCategoryState: vi.fn(),
  saveGlobalCategoryState: vi.fn(),
  getSharedCategoryDriveFileId: vi.fn(),
  setSharedCategoryDriveFileId: vi.fn(),
}))

vi.mock('../lib/categoryMerge', () => ({
  mergeCategoryState: vi.fn(),
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
    onImportSharedPortfolio: vi.fn().mockResolvedValue(undefined),
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

function selectPickerMode(name: 'Open' | 'Create' | 'Google Drive') {
  fireEvent.click(screen.getByRole('radio', { name }))
}

function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
}

function selectSharedDriveMode() {
  selectPickerMode('Google Drive')
}

describe('PortfolioPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.confirm = vi.fn().mockReturnValue(true)
    vi.mocked(loadGlobalCategoryState).mockResolvedValue({
      categories: [],
      categoryMappings: [],
      budgetAccountRules: [],
    } as never)
    vi.mocked(getSharedCategoryDriveFileId).mockResolvedValue(undefined)
    vi.mocked(setSharedCategoryDriveFileId).mockResolvedValue(undefined)
    vi.mocked(getPickerDriveAuth).mockReturnValue({} as never)
    vi.mocked(drive.project).mockReturnValue({ pickFile: vi.fn().mockResolvedValue(null) } as never)
  })

  afterEach(() => {
    cleanup()
  })

  describe('existing portfolios list (regression)', () => {
    it('renders the reference mode controls and only the selected panel', () => {
      renderPicker()

      expect((screen.getByRole('radio', { name: 'Open' }) as HTMLInputElement).checked).toBe(true)
      expect(screen.getByRole('radio', { name: 'Create' })).toBeTruthy()
      expect(screen.getByRole('radio', { name: 'Google Drive' })).toBeTruthy()
      expect(screen.queryByPlaceholderText('e.g. Retirement')).toBeFalsy()

      selectPickerMode('Create')
      expect(screen.getByPlaceholderText('e.g. Retirement')).toBeTruthy()
      expect(screen.queryByText('No portfolios yet. Create one to get started.')).toBeFalsy()
    })

    it('keeps the full-width mode segment independent from the settings gear', () => {
      const { container } = renderPicker()

      const segment = container.querySelector('.seg') as HTMLElement
      expect(segment.parentElement?.style.position).toBe('relative')
      expect(segment.parentElement?.style.display).not.toBe('flex')
      expect(segment.style.width).toBe('100%')
      expect(screen.getByRole('button', { name: 'Settings' }).style.position).toBe('absolute')
    })

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

  describe('global mapping', () => {
    it('shows the Settings gear by default and hides category mapping controls until opened', () => {
      renderPicker()

      expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Download Category Mapping' })).toBeFalsy()
      expect(screen.queryByRole('button', { name: 'Import a shared mapping from Google Drive' })).toBeFalsy()
    })

    it('keeps the Settings gear above the selected Google Drive tab', () => {
      renderPicker()
      selectPickerMode('Google Drive')

      expect(screen.getByRole('button', { name: 'Settings' }).style.zIndex).toBe('1')
    })

    it('opens the category mapping settings panel and hides the picker modes', () => {
      renderPicker()
      openSettings()

      expect(screen.getByRole('heading', { name: 'Settings — Category mapping' })).toBeTruthy()
      expect(screen.queryByRole('radio', { name: 'Open' })).toBeFalsy()
      expect(screen.queryByRole('radio', { name: 'Create' })).toBeFalsy()
      expect(screen.queryByRole('radio', { name: 'Google Drive' })).toBeFalsy()
    })

    it('uses a compact settings header with two local-file icon actions', () => {
      renderPicker()
      openSettings()

      const close = screen.getByRole('button', { name: 'Close settings' })
      const heading = screen.getByRole('heading', { name: 'Settings — Category mapping' })
      const importMapping = screen.getByRole('button', { name: 'Import mapping file' })
      const downloadMapping = screen.getByRole('button', { name: 'Download mapping file' }) as HTMLButtonElement
      expect(close.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(heading.compareDocumentPosition(importMapping) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(importMapping.className).toContain('btn-icon')
      expect(downloadMapping.className).toContain('btn-icon')
      expect(downloadMapping.disabled).toBe(true)
      expect(screen.queryByRole('button', { name: 'Import Category Mapping' })).toBeFalsy()
      expect(screen.queryByRole('button', { name: 'Download Category Mapping' })).toBeFalsy()
    })

    it('closes settings and returns to the selected picker mode', () => {
      renderPicker()
      selectPickerMode('Create')
      openSettings()

      fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))

      expect(screen.queryByRole('heading', { name: 'Settings — Category mapping' })).toBeFalsy()
      expect((screen.getByRole('radio', { name: 'Create' }) as HTMLInputElement).checked).toBe(true)
    })

    it('renders category and mapping counts from the loaded global state', async () => {
      vi.mocked(loadGlobalCategoryState).mockResolvedValue({
        categories: [{ id: 'food', name: 'Food' }, { id: 'travel', name: 'Travel' }],
        categoryMappings: [{ id: 'food-mapping' }, { id: 'travel-mapping' }, { id: 'other-mapping' }],
        budgetAccountRules: [],
      } as never)
      renderPicker()
      openSettings()

      expect(await screen.findByText('2 categories · 3 category mappings')).toBeTruthy()
    })

    it('opens category mappings from settings without navigating away', () => {
      window.location.hash = ''
      renderPicker()
      openSettings()

      fireEvent.click(screen.getByRole('button', { name: 'Manage' }))

      expect(window.location.hash).toBe('')
      expect(screen.getByRole('dialog', { name: 'Category mappings' })).toBeTruthy()
    })

    it('loads empty global state and enables Download after importing a valid mapping', async () => {
      const imported = {
        categories: [{ id: 'food', name: 'Food' }],
        categoryMappings: [],
        budgetAccountRules: [],
      }
      vi.mocked(parseCategoryMappingImportFile).mockReturnValue(imported as never)
      vi.mocked(mergeCategoryState).mockReturnValue(imported as never)
      vi.mocked(saveGlobalCategoryState).mockResolvedValue(undefined)
      const { container } = renderPicker()
      openSettings()

      const download = screen.getByRole('button', { name: 'Download mapping file' }) as HTMLButtonElement
      expect(download.disabled).toBe(true)
      await waitFor(() => {
        expect(loadGlobalCategoryState).toHaveBeenCalledWith([])
      })

      const mappingInput = Array.from(container.querySelectorAll('input[type="file"]'))[0] as HTMLInputElement
      fireEvent.change(mappingInput, {
        target: { files: [new File(['{}'], 'mapping.json', { type: 'application/json' })] },
      })

      await waitFor(() => {
        expect(saveGlobalCategoryState).toHaveBeenCalledWith(imported)
        expect(download.disabled).toBe(false)
      })
      fireEvent.click(download)
      expect(downloadJsonAsFile).toHaveBeenCalledWith(imported, 'category-mapping.json')
    })

    it('merges imported mappings with the loaded state instead of replacing it', async () => {
      const existing = {
        categories: [{ id: 'existing', name: 'Existing' }],
        categoryMappings: [{ id: 'existing-mapping' }],
        budgetAccountRules: [],
      }
      const imported = { categories: [{ id: 'new', name: 'New' }], categoryMappings: [], budgetAccountRules: [] }
      const merged = {
        categories: [...existing.categories, ...imported.categories],
        categoryMappings: existing.categoryMappings,
        budgetAccountRules: [],
      }
      vi.mocked(loadGlobalCategoryState).mockResolvedValue(existing as never)
      vi.mocked(parseCategoryMappingImportFile).mockReturnValue(imported as never)
      vi.mocked(mergeCategoryState).mockReturnValue(merged as never)
      vi.mocked(saveGlobalCategoryState).mockResolvedValue(undefined)
      const { container } = renderPicker()
      openSettings()

      await waitFor(() => {
        expect((screen.getByRole('button', { name: 'Download mapping file' }) as HTMLButtonElement).disabled).toBe(false)
      })
      const mappingInput = Array.from(container.querySelectorAll('input[type="file"]'))[0] as HTMLInputElement
      fireEvent.change(mappingInput, { target: { files: [new File(['{}'], 'mapping.json')] } })

      await waitFor(() => {
        expect(mergeCategoryState).toHaveBeenCalledWith(existing, imported)
        expect(saveGlobalCategoryState).toHaveBeenCalledWith(merged)
      })
    })

    it('shows an inline error for malformed imports without changing Download state', async () => {
      vi.mocked(parseCategoryMappingImportFile).mockImplementation(() => {
        throw new Error('bad file')
      })
      const { container } = renderPicker()
      openSettings()
      const download = screen.getByRole('button', { name: 'Download mapping file' }) as HTMLButtonElement
      const mappingInput = Array.from(container.querySelectorAll('input[type="file"]'))[0] as HTMLInputElement

      fireEvent.change(mappingInput, { target: { files: [new File(['not json'], 'mapping.json')] } })

      expect(await screen.findByText('This is not a valid category mapping file.')).toBeTruthy()
      expect(download.disabled).toBe(true)
      expect(saveGlobalCategoryState).not.toHaveBeenCalled()
    })

    it('imports a picked shared mapping from Drive, merges it, and saves its file ID', async () => {
      const existing = {
        categories: [{ id: 'existing', name: 'Existing' }],
        categoryMappings: [],
        budgetAccountRules: [],
      }
      const remote = {
        categories: [{ id: 'shared', name: 'Shared' }],
        categoryMappings: [],
        budgetAccountRules: [],
      }
      const merged = {
        categories: [...existing.categories, ...remote.categories],
        categoryMappings: [],
        budgetAccountRules: [],
      }
      const pickFile = vi.fn().mockResolvedValue({ id: 'shared-file' })
      const auth = {} as never
      vi.mocked(loadGlobalCategoryState).mockResolvedValue(existing as never)
      vi.mocked(drive.project).mockReturnValue({ pickFile } as never)
      vi.mocked(getPickerDriveAuth).mockReturnValue(auth)
      vi.mocked(pullGlobalCategoriesFromDrive).mockResolvedValue(remote as never)
      vi.mocked(mergeCategoryState).mockReturnValue(merged as never)
      vi.mocked(saveGlobalCategoryState).mockResolvedValue(undefined)
      vi.mocked(setSharedCategoryDriveFileId).mockResolvedValue(undefined)
      renderPicker()
      openSettings()

      await waitFor(() => {
        expect((screen.getByRole('button', { name: 'Download mapping file' }) as HTMLButtonElement).disabled).toBe(false)
      })
      fireEvent.click(screen.getByRole('button', { name: 'Import a shared mapping from Google Drive' }))

      await waitFor(() => {
        expect(pickFile).toHaveBeenCalledWith({ unscoped: true, mimeTypes: ['application/json'], multiSelect: false })
        expect(pullGlobalCategoriesFromDrive).toHaveBeenCalledWith(auth, 'picker', 'shared-file')
        expect(mergeCategoryState).toHaveBeenCalledWith(existing, remote)
        expect(saveGlobalCategoryState).toHaveBeenCalledWith(merged)
        expect(setSharedCategoryDriveFileId).toHaveBeenCalledWith('shared-file')
      })
      expect(pullGlobalCategoriesFromDrive).toHaveBeenCalledTimes(1)
      expect(mergeCategoryState).toHaveBeenCalledTimes(1)
      expect(saveGlobalCategoryState).toHaveBeenCalledTimes(1)
      expect(setSharedCategoryDriveFileId).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: 'Download mapping file' }))
      expect(downloadJsonAsFile).toHaveBeenCalledWith(merged, 'category-mapping.json')
    })

    it('does nothing when the shared mapping picker is cancelled', async () => {
      const pickFile = vi.fn().mockResolvedValue(null)
      vi.mocked(drive.project).mockReturnValue({ pickFile } as never)
      renderPicker()
      openSettings()

      fireEvent.click(screen.getByRole('button', { name: 'Import a shared mapping from Google Drive' }))

      await waitFor(() => expect(pickFile).toHaveBeenCalledTimes(1))
      expect(pullGlobalCategoriesFromDrive).not.toHaveBeenCalled()
      expect(mergeCategoryState).not.toHaveBeenCalled()
      expect(saveGlobalCategoryState).not.toHaveBeenCalled()
      expect(setSharedCategoryDriveFileId).not.toHaveBeenCalled()
    })

    it('shows the Shared badge only when a shared mapping file ID is persisted', async () => {
      vi.mocked(getSharedCategoryDriveFileId).mockResolvedValue('shared-file')
      renderPicker()
      openSettings()

      await waitFor(() => {
        expect(screen.getByText('Shared')).toBeTruthy()
      })
    })

    it('unlinks the shared mapping without changing local category data', async () => {
      const localState = {
        categories: [{ id: 'food', name: 'Food' }],
        categoryMappings: [{ id: 'food-mapping' }],
        budgetAccountRules: [{ id: 'food-rule' }],
      }
      vi.mocked(getSharedCategoryDriveFileId).mockResolvedValue('shared-file')
      vi.mocked(loadGlobalCategoryState).mockResolvedValue(localState as never)
      renderPicker()
      openSettings()

      await waitFor(() => expect(screen.getByText('Shared')).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))

      await waitFor(() => {
        expect(setSharedCategoryDriveFileId).toHaveBeenCalledWith(null)
        expect(screen.queryByText('Shared')).toBeFalsy()
      })
      expect(saveGlobalCategoryState).not.toHaveBeenCalled()
      expect(mergeCategoryState).not.toHaveBeenCalled()
    })

    it('does not render an unlink control when no shared mapping override is set', () => {
      renderPicker()
      openSettings()

      expect(screen.queryByRole('button', { name: 'Unlink' })).toBeFalsy()
      expect(setSharedCategoryDriveFileId).not.toHaveBeenCalled()
    })

    it('does not start a polling interval while rendering the Global Mapping section', async () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
      renderPicker()
      openSettings()

      await Promise.resolve()

      expect(setIntervalSpy).not.toHaveBeenCalled()
      setIntervalSpy.mockRestore()
    })

    it('shows an inline error without saving the file ID when the picked shared mapping is malformed', async () => {
      const pickFile = vi.fn().mockResolvedValue({ id: 'malformed-file' })
      vi.mocked(drive.project).mockReturnValue({ pickFile } as never)
      vi.mocked(pullGlobalCategoriesFromDrive).mockResolvedValue(null)
      renderPicker()
      openSettings()

      fireEvent.click(screen.getByRole('button', { name: 'Import a shared mapping from Google Drive' }))

      expect(await screen.findByText('This is not a valid shared category mapping file.')).toBeTruthy()
      expect(mergeCategoryState).not.toHaveBeenCalled()
      expect(saveGlobalCategoryState).not.toHaveBeenCalled()
      expect(setSharedCategoryDriveFileId).not.toHaveBeenCalled()
    })
  })

  describe('file-import panel', () => {
    it('clicking the "Import from file" button triggers the hidden file input', () => {
      const { container } = renderPicker()
      selectPickerMode('Create')
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
      selectPickerMode('Create')
      const fileInput = getFileInput(container)
      const file = new File(['not json'], 'garbage.txt', { type: 'text/plain' })

      fireEvent.change(fileInput, { target: { files: [file] } })

      expect(await screen.findByText('This is not a valid backup file.')).toBeTruthy()
      expect(screen.queryByPlaceholderText("Enter the backup's password")).toBeFalsy()
    })

    it('picking a valid envelope file prefills the name and shows a password field', async () => {
      vi.mocked(parseImportFile).mockReturnValue(fakeEnvelope)
      const { container } = renderPicker()
      selectPickerMode('Create')
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
      selectPickerMode('Create')
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
      selectPickerMode('Create')
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
    it('shows My portfolios and Shared portfolio sections together without nested tabs', () => {
      const { container } = renderPicker()
      selectPickerMode('Google Drive')

      const myPortfoliosHeading = screen.getByText('My portfolios')
      const sharedPortfolioHeading = screen.getByText('Shared portfolio')
      const myPortfolios = screen.getByText("Restore a portfolio you've backed up to Google Drive.")
      const sharedPortfolio = screen.getByText('Open a portfolio someone else shared with you on Google Drive.')
      expect(myPortfoliosHeading.compareDocumentPosition(sharedPortfolioHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(myPortfolios.compareDocumentPosition(sharedPortfolio) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(container.querySelectorAll('input[name="portfolioDriveMode"]')).toHaveLength(0)
      expect(myPortfolios.parentElement?.nextElementSibling?.className).toContain('hr')
    })

    it('disables the trigger button and shows offline tooltip when isOnline is false', () => {
      renderPicker({ isOnline: false })
      selectPickerMode('Google Drive')
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
      selectPickerMode('Google Drive')

      fireEvent.click(screen.getByRole('button', { name: 'Load from Google Drive' }))

      expect(onListDriveFolders).toHaveBeenCalled()
      await screen.findByText('Brokerage')
      expect(screen.queryByText('RETIREMENT')).toBeFalsy()
    })

    it('shows "No portfolios found in Google Drive." when the list is empty', async () => {
      renderPicker({ onListDriveFolders: vi.fn().mockResolvedValue([]) })
      selectPickerMode('Google Drive')

      fireEvent.click(screen.getByRole('button', { name: 'Load from Google Drive' }))

      expect(await screen.findByText('No portfolios found in Google Drive.')).toBeTruthy()
    })

    it('shows "All Google Drive portfolios are already in Your Portfolios." when all folders match local portfolios', async () => {
      renderPicker({
        portfolios: [makePortfolio({ name: 'Retirement' })],
        onListDriveFolders: vi.fn().mockResolvedValue([{ name: 'retirement', id: 'd1' }]),
      })
      selectPickerMode('Google Drive')

      fireEvent.click(screen.getByRole('button', { name: 'Load from Google Drive' }))

      expect(
        await screen.findByText('All Google Drive portfolios are already in Your Portfolios.')
      ).toBeTruthy()
    })

    it("shows \"Couldn't connect to Google Drive.\" and no rows when onListDriveFolders rejects", async () => {
      renderPicker({ onListDriveFolders: vi.fn().mockRejectedValue(new Error('network')) })
      selectPickerMode('Google Drive')

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
      selectPickerMode('Google Drive')

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
      const alphaRow = passwordInput.closest('div[style*="padding"]') as HTMLElement
      fireEvent.change(passwordInput, { target: { value: 'wrong' } })
      fireEvent.click(within(alphaRow).getByRole('button', { name: 'Import' }))

      expect(await screen.findByText('Incorrect password.')).toBeTruthy()
      // Second row unaffected: still just its trigger button, no error text near it.
      const betaRow = screen.getByText('Beta').closest('div[style*="padding"]') as HTMLElement
      expect(betaRow.querySelector('input[type="password"]')).toBeFalsy()
      expect(betaRow.textContent).not.toContain('Incorrect password.')
    })

    it('happy path calls onImportFromDriveFolder once with (folder, password)', async () => {
      const onImportFromDriveFolder = vi.fn().mockResolvedValue(undefined)
      renderPicker({
        onListDriveFolders: vi.fn().mockResolvedValue([{ name: 'Alpha', id: 'd1' }]),
        onImportFromDriveFolder,
      })
      selectPickerMode('Google Drive')

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

    it('picks a shared portfolio and imports it with the entered password', async () => {
      const pickFile = vi.fn().mockResolvedValue({ name: 'Team portfolio', id: 'shared-folder' })
      const onImportSharedPortfolio = vi.fn().mockResolvedValue(undefined)
      vi.mocked(drive.project).mockReturnValue({ pickFile } as never)
      renderPicker({ onImportSharedPortfolio })
      selectSharedDriveMode()

      fireEvent.click(screen.getByRole('button', { name: 'Import a shared portfolio' }))

      const passwordInput = await screen.findByPlaceholderText("Enter the portfolio's password")
      fireEvent.change(passwordInput, { target: { value: 'correct-pw' } })
      fireEvent.click(screen.getByRole('button', { name: 'Import' }))

      await waitFor(() => {
        expect(pickFile).toHaveBeenCalledWith({ unscoped: true, includeFolders: true, multiSelect: false })
        expect(onImportSharedPortfolio).toHaveBeenCalledWith({ name: 'Team portfolio', id: 'shared-folder' }, 'correct-pw')
      })
    })

    it('does nothing when the shared portfolio picker is cancelled', async () => {
      const pickFile = vi.fn().mockResolvedValue(null)
      vi.mocked(drive.project).mockReturnValue({ pickFile } as never)
      renderPicker()
      selectSharedDriveMode()

      fireEvent.click(screen.getByRole('button', { name: 'Import a shared portfolio' }))

      await waitFor(() => expect(pickFile).toHaveBeenCalledTimes(1))
      expect(screen.queryByPlaceholderText("Enter the portfolio's password")).toBeFalsy()
    })

    it('shows the existing incorrect-password error for a shared portfolio import', async () => {
      const pickFile = vi.fn().mockResolvedValue({ name: 'Team portfolio', id: 'shared-folder' })
      const onImportSharedPortfolio = vi
        .fn()
        .mockRejectedValue(new DriveDecryptError('nope', new Uint8Array(), fakeEnvelope))
      vi.mocked(drive.project).mockReturnValue({ pickFile } as never)
      renderPicker({ onImportSharedPortfolio })
      selectSharedDriveMode()

      fireEvent.click(screen.getByRole('button', { name: 'Import a shared portfolio' }))
      const passwordInput = await screen.findByPlaceholderText("Enter the portfolio's password")
      fireEvent.change(passwordInput, { target: { value: 'wrong' } })
      fireEvent.click(screen.getByRole('button', { name: 'Import' }))

      expect(await screen.findByText('Incorrect password.')).toBeTruthy()
    })

    it('shows the existing malformed-backup error for a picked shared folder', async () => {
      const pickFile = vi.fn().mockResolvedValue({ name: 'Team portfolio', id: 'shared-folder' })
      const onImportSharedPortfolio = vi
        .fn()
        .mockRejectedValue(new DriveMalformedBackupError('missing portfolio-state.json'))
      vi.mocked(drive.project).mockReturnValue({ pickFile } as never)
      renderPicker({ onImportSharedPortfolio })
      selectSharedDriveMode()

      fireEvent.click(screen.getByRole('button', { name: 'Import a shared portfolio' }))
      const passwordInput = await screen.findByPlaceholderText("Enter the portfolio's password")
      fireEvent.change(passwordInput, { target: { value: 'correct-pw' } })
      fireEvent.click(screen.getByRole('button', { name: 'Import' }))

      expect(await screen.findByText('Could not import this portfolio.')).toBeTruthy()
    })
  })

  it('shows the Shared badge only for portfolios linked to a shared Drive folder', () => {
    renderPicker({
      portfolios: [
        makePortfolio({ id: 'shared', name: 'Shared portfolio', sharedDriveFolderId: 'folder-1' }),
        makePortfolio({ id: 'local', name: 'Local portfolio' }),
      ],
    })

    expect(within(screen.getByText('Shared portfolio').parentElement as HTMLElement).getByText('Shared')).toBeTruthy()
    expect(within(screen.getByText('Local portfolio').parentElement as HTMLElement).queryByText('Shared')).toBeFalsy()
  })

  describe('Create panel', () => {
    it('clicking Create with a name entered opens the password+confirm panel', () => {
      renderPicker()
      selectPickerMode('Create')

      expect(screen.queryByText('New password')).toBeFalsy()
      fireEvent.change(screen.getByPlaceholderText('e.g. Retirement'), {
        target: { value: 'New Portfolio' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))

      expect(screen.getByText('New password')).toBeTruthy()
      expect(screen.getByText('Confirm password')).toBeTruthy()
    })

    it('short password shows a validation error and does not call onCreateNew; mismatched confirm shows a different error', async () => {
      const onCreateNew = vi.fn()
      renderPicker({ onCreateNew })
      selectPickerMode('Create')

      fireEvent.change(screen.getByPlaceholderText('e.g. Retirement'), {
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
      selectPickerMode('Create')

      fireEvent.change(screen.getByPlaceholderText('e.g. Retirement'), {
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
      selectPickerMode('Create')

      fireEvent.change(screen.getByPlaceholderText('e.g. Retirement'), {
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
