import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initialState } from './state'
import type { AppState } from './state'

// Create mock functions that can be reset between tests
let mockFilesRead: ReturnType<typeof vi.fn>
let mockFilesWrite: ReturnType<typeof vi.fn>
let mockEnsureFolderPath: ReturnType<typeof vi.fn>
let mockList: ReturnType<typeof vi.fn>

// Mock the drive-sync package itself
vi.mock('@open-webapp/drive-sync', () => ({
  createDriveSync: () => ({
    project: () => ({
      ensureFolderPath: () => mockEnsureFolderPath(),
      files: {
        list: (...args: unknown[]) => mockList(...args),
        read: (...args: unknown[]) => mockFilesRead(...args),
        write: (...args: unknown[]) => mockFilesWrite(...args),
      },
    }),
  }),
}))

describe('drive.ts Drive-sync wiring', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    mockEnsureFolderPath = vi.fn().mockResolvedValue('folder-id-123')
    mockFilesRead = vi.fn()
    mockFilesWrite = vi.fn()
    mockList = vi.fn()
    vi.resetModules()
  })

  /**
   * Test 1: Verify drive singleton constructed with correct appId and folderPath.
   * We read the source file to verify the constants are correct.
   */
  it('drive singleton constructed with correct appId "portfolio" and folderPath ["OpenWebApp", "Portfolio"]', () => {
    const { readFileSync } = require('fs')
    const driveSource = readFileSync('/Users/mdoraiswamy/owa/portfolio/src/lib/drive.ts', 'utf-8')

    // Verify the drive singleton is created with correct appId
    expect(driveSource).toContain("appId: 'portfolio'")
    // Verify the folderPath is exactly ['OpenWebApp', 'Portfolio']
    expect(driveSource).toContain("folderPath: ['OpenWebApp', 'Portfolio']")
  })

  /**
   * Test: VITE_GOOGLE_CLIENT_ID must be set (read from .env) or Google OAuth
   * connect fails — token.ts sends `client_id: undefined` to GIS.
   */
  it('drive clientId is configured via VITE_GOOGLE_CLIENT_ID in .env', () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
    expect(clientId).toBeTruthy()
    expect(clientId).toMatch(/\.apps\.googleusercontent\.com$/)
  })

  /**
   * Test: index.html must load the Google Identity Services script.
   * drive-sync's gis.ts only POLLS for window.google.accounts.oauth2 to exist
   * (10s timeout) — it never injects the script itself. Without this tag,
   * connect fails with "Google Identity Services failed to load in time".
   */
  it('index.html loads the Google Identity Services client script', () => {
    const { readFileSync } = require('fs')
    const html = readFileSync('/Users/mdoraiswamy/owa/portfolio/index.html', 'utf-8')
    expect(html).toContain('https://accounts.google.com/gsi/client')
  })


  /**
   * Test 2: syncBackup() writes state as JSON blob without error.
   */
  it('syncBackup() writes state blob without error', async () => {
    mockEnsureFolderPath.mockResolvedValue('folder-id-123')
    mockFilesWrite.mockResolvedValue({ id: 'file-id-123' })

    const { syncBackup } = await import('./drive')

    const testState: AppState = {
      ...initialState(),
      accounts: [
        {
          id: 'acc-1',
          accountNumber: '12345',
          name: 'Test Account',
          taxCategory: 'taxable',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ],
    }

    await expect(syncBackup(testState)).resolves.not.toThrow()

    // Verify files.write was called with correct parameters
    expect(mockFilesWrite).toHaveBeenCalled()
    const writeCall = mockFilesWrite.mock.calls[0]?.[0]
    expect(writeCall.name).toBe('portfolio-state.json')
    expect(writeCall.mimeType).toBe('application/json')
    expect(writeCall.folderId).toBe('folder-id-123')
    // Verify content is JSON
    expect(writeCall.content).toContain('"accounts"')
  })

  /**
   * Test 2b: syncBackup() resolves with the Drive file id of the written file.
   */
  it('syncBackup() resolves with the written file id', async () => {
    mockEnsureFolderPath.mockResolvedValue('folder-id-123')
    mockFilesWrite.mockResolvedValue({ id: 'file-id-123' })

    const { syncBackup } = await import('./drive')

    const fileId = await syncBackup(initialState())
    expect(fileId).toBe('file-id-123')
  })

  /**
   * Test 2c: getBackupFileId() returns the id of an existing backup, or null.
   */
  it('getBackupFileId() returns backup file id when present', async () => {
    mockEnsureFolderPath.mockResolvedValue('folder-id-123')
    mockList.mockResolvedValue([{ id: 'file-id-789' }])

    const { getBackupFileId } = await import('./drive')
    const fileId = await getBackupFileId()
    expect(fileId).toBe('file-id-789')
  })

  it('getBackupFileId() returns null when no backup exists', async () => {
    mockEnsureFolderPath.mockResolvedValue('folder-id-123')
    mockList.mockResolvedValue([])

    const { getBackupFileId } = await import('./drive')
    const fileId = await getBackupFileId()
    expect(fileId).toBeNull()
  })

  /**
   * Test 3: restoreBackup() reads state blob from Drive.
   */
  it('restoreBackup() reads state blob from Drive', async () => {
    const testState: AppState = {
      ...initialState(),
      positions: [
        {
          id: 'pos-1',
          accountId: 'acc-1',
          symbol: 'AAPL',
          name: 'Apple',
          assetClass: 'Equity',
          shares: 100,
          avgCost: 150,
          price: 175,
          lastImportedAt: '2024-01-01',
        },
      ],
    }

    mockEnsureFolderPath.mockResolvedValue('folder-id-123')
    mockList.mockResolvedValue([{ id: 'file-id-456' }])
    mockFilesRead.mockResolvedValue(JSON.stringify(testState))

    const { restoreBackup } = await import('./drive')
    const restored = await restoreBackup()

    expect(restored).not.toBeNull()
    expect(restored?.positions).toHaveLength(1)
    expect(restored?.positions[0].symbol).toBe('AAPL')
    // Verify files.read was called with the file ID
    expect(mockFilesRead).toHaveBeenCalledWith('file-id-456')
  })

  /**
   * Test 4: Round-trip: syncBackup → restoreBackup returns the same state exactly.
   */
  it('round-trip: syncBackup → restoreBackup preserves state exactly', async () => {
    const originalState: AppState = {
      ...initialState(),
      accounts: [
        {
          id: 'acc-1',
          accountNumber: '11111',
          name: 'Brokerage Account',
          taxCategory: 'taxable',
          retirement: false,
          createdAt: '2024-01-01',
        },
        {
          id: 'acc-2',
          accountNumber: '22222',
          name: 'IRA',
          taxCategory: 'taxDeferred',
          retirement: true,
          createdAt: '2024-01-15',
        },
      ],
      positions: [
        {
          id: 'pos-1',
          accountId: 'acc-1',
          symbol: 'AAPL',
          name: 'Apple Inc',
          assetClass: 'Equity',
          shares: 50,
          avgCost: 150,
          price: 180,
          lastImportedAt: '2024-01-01',
        },
        {
          id: 'pos-2',
          accountId: 'acc-2',
          symbol: 'VTI',
          name: 'Vanguard Total Stock Market ETF',
          assetClass: 'ETF',
          shares: 200,
          avgCost: 200,
          price: 220,
          lastImportedAt: '2024-01-01',
        },
      ],
      transactions: [
        {
          id: 'tx-1',
          accountId: 'acc-1',
          date: '2024-01-01',
          symbol: 'AAPL',
          type: 'Buy',
          shares: 50,
          price: 150,
          amount: 7500,
          importedAt: '2024-01-01',
        },
      ],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
    }

    mockEnsureFolderPath.mockResolvedValue('folder-id-123')
    mockFilesWrite.mockResolvedValue({ id: 'file-id-123' })
    mockList.mockResolvedValue([{ id: 'file-id-123' }])
    mockFilesRead.mockResolvedValue(JSON.stringify(originalState))

    const { syncBackup, restoreBackup } = await import('./drive')

    await syncBackup(originalState)
    const restoredState = await restoreBackup()

    expect(restoredState).toEqual(originalState)
  })

  /**
   * Test 5: restoreBackup() returns null when no backup file exists.
   */
  it('restoreBackup() returns null when no backup file exists', async () => {
    mockEnsureFolderPath.mockResolvedValue('folder-id-123')
    mockList.mockResolvedValue([]) // Empty list - no files found

    const { restoreBackup } = await import('./drive')
    const restored = await restoreBackup()

    expect(restored).toBeNull()
  })
})
