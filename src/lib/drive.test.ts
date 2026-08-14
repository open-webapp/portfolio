import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NeedsReauthError } from '@open-webapp/drive-sync'
import { initialState } from './state'
import type { AppState } from './state'
import { deriveKey, encryptState, generateSalt } from './crypto'
import type { EncryptedEnvelope } from './crypto'

// Create mock functions that can be reset between tests
let mockFilesRead: ReturnType<typeof vi.fn>
let mockFilesWrite: ReturnType<typeof vi.fn>
let mockEnsureFolderPath: ReturnType<typeof vi.fn>
let mockList: ReturnType<typeof vi.fn>
let mockGetConnection: ReturnType<typeof vi.fn>
let mockConnect: ReturnType<typeof vi.fn>
let mockGetAccessToken: ReturnType<typeof vi.fn>

// Mock the drive-sync package itself (spreading the real module so real error
// classes like NeedsReauthError stay instanceof-compatible).
vi.mock('@open-webapp/drive-sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@open-webapp/drive-sync')>()
  return {
    ...actual,
    createDriveSync: () => ({
      project: () => ({
        getConnection: () => mockGetConnection(),
        connect: () => mockConnect(),
        ensureFolderPath: () => mockEnsureFolderPath(),
        getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
        files: {
          list: (...args: unknown[]) => mockList(...args),
          read: (...args: unknown[]) => mockFilesRead(...args),
          write: (...args: unknown[]) => mockFilesWrite(...args),
        },
      }),
    }),
  }
})

describe('drive.ts Drive-sync wiring', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    mockEnsureFolderPath = vi.fn().mockResolvedValue('folder-id-123')
    mockFilesRead = vi.fn()
    mockFilesWrite = vi.fn()
    mockList = vi.fn()
    // Default to a healthy, non-expired connection so sync/restore do not
    // trigger the interactive connect flow unless a test opts in.
    mockGetConnection = vi.fn().mockResolvedValue({
      email: 'test@example.com',
      needsReauth: false,
      expiresAt: Date.now() + 60 * 60 * 1000,
    })
    mockConnect = vi.fn()
    mockGetAccessToken = vi.fn().mockResolvedValue('mock-access-token')
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
   * Test 2: syncBackup() writes an encrypted envelope blob without error.
   */
  it('syncBackup() writes an encrypted envelope blob without error', async () => {
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
          institution: 'Test Bank',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ],
    }

    const salt = generateSalt()
    const key = await deriveKey('correct horse battery staple', salt)

    await expect(syncBackup(testState, key, salt)).resolves.not.toThrow()

    // Verify files.write was called with correct parameters
    expect(mockFilesWrite).toHaveBeenCalled()
    const writeCall = mockFilesWrite.mock.calls[0]?.[0]
    expect(writeCall.name).toBe('portfolio-state.json')
    expect(writeCall.mimeType).toBe('application/json')
    expect(writeCall.folderId).toBe('folder-id-123')

    // Content must be a well-formed EncryptedEnvelope, not raw AppState JSON.
    const envelope = JSON.parse(writeCall.content) as EncryptedEnvelope
    expect(envelope.version).toBe(1)
    expect(typeof envelope.salt).toBe('string')
    expect(typeof envelope.iv).toBe('string')
    expect(typeof envelope.ciphertext).toBe('string')

    // The plaintext account name must NOT appear anywhere in the written
    // content — proves the payload is actually encrypted, not plaintext.
    expect(writeCall.content).not.toContain('Test Account')
    expect(writeCall.content).not.toContain('"accounts"')
  })

  /**
   * Test 2b: syncBackup() resolves with the Drive file id of the written file.
   */
  it('syncBackup() resolves with the written file id', async () => {
    mockEnsureFolderPath.mockResolvedValue('folder-id-123')
    mockFilesWrite.mockResolvedValue({ id: 'file-id-123' })

    const { syncBackup } = await import('./drive')

    const salt = generateSalt()
    const key = await deriveKey('a-password', salt)

    const fileId = await syncBackup(initialState(), key, salt)
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
   * Test 3: restoreBackup() reads and decrypts an envelope from Drive.
   */
  it('restoreBackup() reads and decrypts an envelope blob from Drive', async () => {
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

    const salt = generateSalt()
    const key = await deriveKey('correct horse battery staple', salt)
    const envelope = await encryptState(testState, key, salt)

    mockEnsureFolderPath.mockResolvedValue('folder-id-123')
    mockList.mockResolvedValue([{ id: 'file-id-456' }])
    mockFilesRead.mockResolvedValue(JSON.stringify(envelope))

    const { restoreBackup } = await import('./drive')
    const restored = await restoreBackup(key)

    expect(restored).not.toBeNull()
    expect(restored?.positions).toHaveLength(1)
    expect(restored?.positions[0].symbol).toBe('AAPL')
    // Verify files.read was called with the file ID
    expect(mockFilesRead).toHaveBeenCalledWith('file-id-456')
  })

  /**
   * Test 4: Round-trip: syncBackup → restoreBackup with the correct key
   * returns the same state exactly.
   */
  it('round-trip: syncBackup → restoreBackup with the correct key preserves state exactly', async () => {
    const originalState: AppState = {
      ...initialState(),
      accounts: [
        {
          id: 'acc-1',
          accountNumber: '11111',
          name: 'Brokerage Account',
          institution: 'Brokerage Co',
          retirement: false,
          createdAt: '2024-01-01',
        },
        {
          id: 'acc-2',
          accountNumber: '22222',
          name: 'IRA',
          institution: 'IRA Co',
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
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
    }

    const salt = generateSalt()
    const key = await deriveKey('correct horse battery staple', salt)

    // Capture whatever syncBackup writes and feed it back out of files.read,
    // exactly as the real Drive round-trip would.
    mockEnsureFolderPath.mockResolvedValue('folder-id-123')
    mockFilesWrite.mockImplementation(async (args: { content: string }) => {
      mockFilesRead.mockResolvedValue(args.content)
      return { id: 'file-id-123' }
    })
    mockList.mockResolvedValue([{ id: 'file-id-123' }])

    const { syncBackup, restoreBackup } = await import('./drive')

    await syncBackup(originalState, key, salt)
    const restoredState = await restoreBackup(key)

    expect(restoredState).toEqual(originalState)
  })

  /**
   * Test 4b: restoreBackup() with a key derived from a different password
   * throws DriveDecryptError, carrying the salt and parsed envelope.
   */
  it('restoreBackup() with the wrong key throws DriveDecryptError carrying salt and envelope', async () => {
    const testState = initialState()
    const salt = generateSalt()
    const correctKey = await deriveKey('correct-password', salt)
    const wrongKey = await deriveKey('wrong-password', salt)
    const envelope = await encryptState(testState, correctKey, salt)

    mockEnsureFolderPath.mockResolvedValue('folder-id-123')
    mockList.mockResolvedValue([{ id: 'file-id-456' }])
    mockFilesRead.mockResolvedValue(JSON.stringify(envelope))

    const { restoreBackup, DriveDecryptError } = await import('./drive')

    let caught: unknown
    try {
      await restoreBackup(wrongKey)
      expect.fail('expected restoreBackup to throw')
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(DriveDecryptError)
    const decryptError = caught as InstanceType<typeof DriveDecryptError>
    expect(decryptError.envelope).toEqual(envelope)

    // decryptError.salt must decode (base64) to the same bytes as the salt
    // used at encrypt time.
    const expectedSaltB64 = btoa(String.fromCharCode(...salt))
    const actualSaltB64 = btoa(String.fromCharCode(...decryptError.salt))
    expect(actualSaltB64).toBe(expectedSaltB64)
  })

  /**
   * Test 4c: restoreBackup() on a non-decrypt failure (e.g. network error
   * reading the file) propagates the original error unchanged.
   */
  it('restoreBackup() propagates a non-decrypt failure unchanged (not wrapped as DriveDecryptError)', async () => {
    const salt = generateSalt()
    const key = await deriveKey('some-password', salt)

    mockEnsureFolderPath.mockResolvedValue('folder-id-123')
    mockList.mockResolvedValue([{ id: 'file-id-456' }])
    const networkError = new Error('network request failed')
    mockFilesRead.mockRejectedValue(networkError)

    const { restoreBackup, DriveDecryptError } = await import('./drive')

    let caught: unknown
    try {
      await restoreBackup(key)
      expect.fail('expected restoreBackup to throw')
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(networkError)
    expect(caught instanceof DriveDecryptError).toBe(false)
  })

  /**
   * Test 5: restoreBackup() returns null when no backup file exists.
   */
  it('restoreBackup() returns null when no backup file exists', async () => {
    mockEnsureFolderPath.mockResolvedValue('folder-id-123')
    mockList.mockResolvedValue([]) // Empty list - no files found

    const { restoreBackup } = await import('./drive')
    const salt = generateSalt()
    const key = await deriveKey('some-password', salt)
    const restored = await restoreBackup(key)

    expect(restored).toBeNull()
  })

  /**
   * Test 5b: restoreBackup() times out if files.read() hangs (e.g. shared file
   * with permission issues). Prevents indefinite hangs.
   */
  it('restoreBackup() times out if files.read hangs', async () => {
    vi.useFakeTimers()
    try {
      mockEnsureFolderPath.mockResolvedValue('folder-id-123')
      mockList.mockResolvedValue([{ id: 'file-id-456' }])
      // Mock a read that never resolves (simulates a hanging shared file)
      mockFilesRead.mockImplementation(() => new Promise(() => {}))

      const { restoreBackup } = await import('./drive')
      const salt = generateSalt()
      const key = await deriveKey('some-password', salt)

      const restorePromise = restoreBackup(key).catch(e => {
        // Catch the error to prevent unhandled rejection
        return e
      })

      // Advance timers to trigger the timeout (30 seconds)
      await vi.advanceTimersByTimeAsync(30000)

      const caught = await restorePromise

      expect(caught).toBeInstanceOf(Error)
      expect((caught as Error).message).toContain('timed out')
      expect((caught as Error).message).toContain('files.read')
    } finally {
      vi.useRealTimers()
    }
  })

  describe('restoreBackupFromFileId()', () => {
    it('reads and decrypts a file by id directly, bypassing the by-name folder lookup', async () => {
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
      const salt = generateSalt()
      const key = await deriveKey('correct horse battery staple', salt)
      const envelope = await encryptState(testState, key, salt)
      mockFilesRead.mockResolvedValue(JSON.stringify(envelope))

      const { restoreBackupFromFileId } = await import('./drive')
      const restored = await restoreBackupFromFileId('shared-file-id-789', key)

      expect(restored.positions[0].symbol).toBe('AAPL')
      expect(mockFilesRead).toHaveBeenCalledWith('shared-file-id-789')
      // Must not touch the by-name lookup at all — that's the whole point of this path.
      expect(mockEnsureFolderPath).not.toHaveBeenCalled()
      expect(mockList).not.toHaveBeenCalled()
    })

    it('throws DriveDecryptError carrying salt and envelope on a wrong-password mismatch', async () => {
      const testState = initialState()
      const salt = generateSalt()
      const correctKey = await deriveKey('correct-password', salt)
      const wrongKey = await deriveKey('wrong-password', salt)
      const envelope = await encryptState(testState, correctKey, salt)
      mockFilesRead.mockResolvedValue(JSON.stringify(envelope))

      const { restoreBackupFromFileId, DriveDecryptError } = await import('./drive')

      let caught: unknown
      try {
        await restoreBackupFromFileId('shared-file-id-789', wrongKey)
        expect.fail('expected restoreBackupFromFileId to throw')
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(DriveDecryptError)
      expect((caught as InstanceType<typeof DriveDecryptError>).envelope).toEqual(envelope)
    })

    it('throws when the picked file is empty/unreadable', async () => {
      mockFilesRead.mockResolvedValue(null)
      const { restoreBackupFromFileId } = await import('./drive')
      const salt = generateSalt()
      const key = await deriveKey('some-password', salt)

      await expect(restoreBackupFromFileId('shared-file-id-789', key)).rejects.toThrow(
        'empty or unreadable'
      )
    })
  })

  describe('extractDriveFileId', () => {
    it('extracts file id from /file/d/FILE_ID/view?usp=sharing URL', async () => {
      const { extractDriveFileId } = await import('./drive')
      const fileId = extractDriveFileId('https://drive.google.com/file/d/1AbC-XyZ_123/view?usp=sharing')
      expect(fileId).toBe('1AbC-XyZ_123')
    })

    it('extracts file id from ?id=FILE_ID URL parameter', async () => {
      const { extractDriveFileId } = await import('./drive')
      const fileId = extractDriveFileId('https://drive.google.com/open?id=1AbC-XyZ_123')
      expect(fileId).toBe('1AbC-XyZ_123')
    })

    it('accepts bare file id (≥10 chars, alphanumeric + hyphen + underscore)', async () => {
      const { extractDriveFileId } = await import('./drive')
      const fileId = extractDriveFileId('1AbC-XyZ_1234567890')
      expect(fileId).toBe('1AbC-XyZ_1234567890')
    })

    it('returns null for invalid input (not a URL or valid id)', async () => {
      const { extractDriveFileId } = await import('./drive')
      const fileId = extractDriveFileId('not a url or id!!')
      expect(fileId).toBeNull()
    })

    it('returns null for empty string', async () => {
      const { extractDriveFileId } = await import('./drive')
      const fileId = extractDriveFileId('')
      expect(fileId).toBeNull()
    })

    it('returns null for whitespace-only string', async () => {
      const { extractDriveFileId } = await import('./drive')
      const fileId = extractDriveFileId('   ')
      expect(fileId).toBeNull()
    })

    it('returns null for short bare string (<10 chars)', async () => {
      const { extractDriveFileId } = await import('./drive')
      const fileId = extractDriveFileId('abc123')
      expect(fileId).toBeNull()
    })
  })

  describe('Drive auth / token validation', () => {
    const futureConn = {
      email: 'user@example.com',
      needsReauth: false,
      expiresAt: Date.now() + 60 * 60 * 1000,
    }
    const expiredConn = {
      email: 'user@example.com',
      needsReauth: false,
      expiresAt: Date.now() - 1000,
    }

    it('getDriveAuthStatus() reports disconnected when no connection exists', async () => {
      mockGetConnection.mockResolvedValue(null)

      const { getDriveAuthStatus } = await import('./drive')
      const status = await getDriveAuthStatus()

      expect(status.connected).toBe(false)
      expect(status.email).toBeNull()
      expect(status.expiresAt).toBeNull()
      expect(status.tokenValid).toBe(false)
    })

    it('getDriveAuthStatus() reports a valid token when expiry is in the future', async () => {
      mockGetConnection.mockResolvedValue(futureConn)

      const { getDriveAuthStatus } = await import('./drive')
      const status = await getDriveAuthStatus()

      expect(status.connected).toBe(true)
      expect(status.email).toBe('user@example.com')
      expect(status.tokenValid).toBe(true)
    })

    it('getDriveAuthStatus() reports an invalid token when it has expired', async () => {
      mockGetConnection.mockResolvedValue(expiredConn)

      const { getDriveAuthStatus } = await import('./drive')
      const status = await getDriveAuthStatus()

      expect(status.connected).toBe(true)
      expect(status.tokenValid).toBe(false)
    })

    it('getDriveAuthStatus() reports an invalid token when scopes are incomplete', async () => {
      mockGetConnection.mockResolvedValue({
        email: 'user@example.com',
        needsReauth: true,
        expiresAt: Date.now() + 60 * 60 * 1000,
      })

      const { getDriveAuthStatus } = await import('./drive')
      const status = await getDriveAuthStatus()

      expect(status.tokenValid).toBe(false)
    })

    it('syncBackup() reuses a valid cached token without opening Google auth', async () => {
      mockGetConnection.mockResolvedValue(futureConn)
      mockFilesWrite.mockResolvedValue({ id: 'file-id-123' })

      const { syncBackup } = await import('./drive')
      const salt = generateSalt()
      const key = await deriveKey('some-password', salt)
      await syncBackup(initialState(), key, salt)

      expect(mockConnect).not.toHaveBeenCalled()
    })

    it('syncBackup() triggers Google auth exactly once when the token has expired', async () => {
      mockGetConnection.mockResolvedValue(expiredConn)
      mockConnect.mockResolvedValue(futureConn)
      mockFilesWrite.mockResolvedValue({ id: 'file-id-123' })

      const { syncBackup } = await import('./drive')
      const salt = generateSalt()
      const key = await deriveKey('some-password', salt)
      await syncBackup(initialState(), key, salt)

      expect(mockConnect).toHaveBeenCalledTimes(1)
    })

    it('syncBackup() triggers Google auth once when never connected', async () => {
      mockGetConnection.mockResolvedValue(null)
      mockConnect.mockResolvedValue(futureConn)
      mockFilesWrite.mockResolvedValue({ id: 'file-id-123' })

      const { syncBackup } = await import('./drive')
      const salt = generateSalt()
      const key = await deriveKey('some-password', salt)
      await syncBackup(initialState(), key, salt)

      expect(mockConnect).toHaveBeenCalledTimes(1)
    })

    it('concurrent syncs open at most one Google auth window', async () => {
      mockGetConnection.mockResolvedValue(expiredConn)
      mockConnect.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(futureConn), 10))
      )
      mockFilesWrite.mockResolvedValue({ id: 'file-id-123' })

      const { syncBackup } = await import('./drive')
      const salt = generateSalt()
      const key = await deriveKey('some-password', salt)
      await Promise.all([
        syncBackup(initialState(), key, salt),
        syncBackup(initialState(), key, salt),
      ])

      expect(mockConnect).toHaveBeenCalledTimes(1)
    })

    it('restoreBackup() triggers Google auth exactly once when the token has expired', async () => {
      mockGetConnection.mockResolvedValue(expiredConn)
      mockConnect.mockResolvedValue(futureConn)
      mockList.mockResolvedValue([]) // no backup file -> returns null

      const { restoreBackup } = await import('./drive')
      const salt = generateSalt()
      const key = await deriveKey('some-password', salt)
      const restored = await restoreBackup(key)

      expect(restored).toBeNull()
      expect(mockConnect).toHaveBeenCalledTimes(1)
    })

    it('getBackupFileId() returns null instead of throwing when the token is expired', async () => {
      mockEnsureFolderPath.mockRejectedValue(new NeedsReauthError('Silent token acquisition failed'))

      const { getBackupFileId } = await import('./drive')
      const fileId = await getBackupFileId()

      expect(fileId).toBeNull()
    })
  })

  describe('openDrivePicker', () => {
    let mockGapi: any
    let builderCalls: any

    beforeEach(() => {
      vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', 'fake-api-key')
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '1234567890-abcdef.apps.googleusercontent.com')
      builderCalls = {}
      mockGapi = {
        load: vi.fn((lib, opts) => {
          if (lib === 'picker' && opts.callback) opts.callback()
        }),
        picker: {
          PickerBuilder: class {
            addView(view: any) { builderCalls.view = view; return this }
            setOAuthToken(token: string) { builderCalls.token = token; return this }
            setDeveloperKey(key: string) { builderCalls.apiKey = key; return this }
            setAppId(appId: string) { builderCalls.appId = appId; return this }
            setOrigin(origin: string) { builderCalls.origin = origin; return this }
            setCallback(cb: any) { builderCalls.callback = cb; return this }
            build() { return { setVisible: vi.fn() } }
          },
          DocsView: class {
            setParent(folderId: string) { builderCalls.parentFolderId = folderId; return this }
          },
        },
      }
      ;(window as any).gapi = mockGapi
    })

    afterEach(() => {
      delete (window as any).gapi
      vi.unstubAllEnvs()
    })

    it('passes OAuth token, API key, and default folder id to the Picker builder', async () => {
      // Assumes the module's Drive mock already returns a folder id from
      // project.ensureFolderPath() (same mock used by syncBackup/restoreBackup tests).
      mockEnsureFolderPath.mockResolvedValue('folder-id-123')
      const { openDrivePicker } = await import('./drive')
      await openDrivePicker('fake-token', vi.fn(), vi.fn())

      expect(builderCalls.token).toBe('fake-token')
      expect(builderCalls.apiKey).toBe('fake-api-key')
      expect(builderCalls.parentFolderId).toBeTruthy() // OpenWebApp/Portfolio folder id
    })

    // Regression: platform.js (the legacy Sign-In library) also exposes
    // gapi.load, so loading Picker through it appears to work — but it
    // installs its own gapi.iframes context and Picker opens with a `parent`
    // that isn't this page, which Google rejects with a 401 on the frame.
    it('loads Picker from api.js, not platform.js', async () => {
      delete (window as any).gapi
      const appended: string[] = []
      const appendSpy = vi
        .spyOn(document.head, 'appendChild')
        .mockImplementation(((node: any) => {
          if (node?.src) appended.push(node.src)
          return node
        }) as any)

      try {
        const { openDrivePicker } = await import('./drive')
        mockEnsureFolderPath.mockResolvedValue('folder-id-123')
        // Never resolves (the script never loads); we only care about the src.
        void openDrivePicker('fake-token', vi.fn(), vi.fn()).catch(() => {})
        await Promise.resolve()

        expect(appended).toContain('https://apis.google.com/js/api.js')
        expect(appended.join(' ')).not.toContain('platform.js')
      } finally {
        appendSpy.mockRestore()
        ;(window as any).gapi = mockGapi
      }
    })

    // Regression: without setAppId(), Picker discards the drive.file-scoped
    // OAuth token, shows its own sign-in prompt, and then reports "The API
    // developer key is invalid" — the picker UI never appears.
    it('sets the Picker app id to the project number derived from the OAuth client id', async () => {
      mockEnsureFolderPath.mockResolvedValue('folder-id-123')
      const { openDrivePicker } = await import('./drive')
      await openDrivePicker('fake-token', vi.fn(), vi.fn())

      expect(builderCalls.appId).toBe('1234567890')
    })

    it('prefers an explicit VITE_GOOGLE_PROJECT_NUMBER over the client id prefix', async () => {
      vi.stubEnv('VITE_GOOGLE_PROJECT_NUMBER', '99887766')
      mockEnsureFolderPath.mockResolvedValue('folder-id-123')
      const { openDrivePicker } = await import('./drive')
      await openDrivePicker('fake-token', vi.fn(), vi.fn())

      expect(builderCalls.appId).toBe('99887766')
    })

    it('throws a descriptive error when no app id can be resolved', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
      vi.stubEnv('VITE_GOOGLE_PROJECT_NUMBER', '')
      const { openDrivePicker } = await import('./drive')
      await expect(openDrivePicker('fake-token', vi.fn(), vi.fn())).rejects.toThrow(/app id/i)
    })

    it('throws a descriptive error when VITE_GOOGLE_PICKER_API_KEY is not set', async () => {
      vi.unstubAllEnvs()
      vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', '')
      const { openDrivePicker } = await import('./drive')
      await expect(openDrivePicker('fake-token', vi.fn(), vi.fn())).rejects.toThrow(/API key/i)
    })

    it('calls onSelect with the picked file id when Picker callback fires with action "picked"', async () => {
      mockEnsureFolderPath.mockResolvedValue('folder-id-123')
      const { openDrivePicker } = await import('./drive')
      const onSelect = vi.fn()
      await openDrivePicker('fake-token', onSelect, vi.fn())
      builderCalls.callback({ action: 'picked', docs: [{ id: 'picked-file-id', name: 'x', mimeType: 'application/json', type: 'file' }] })
      expect(onSelect).toHaveBeenCalledWith('picked-file-id')
    })

    it('calls onCancel when Picker callback fires with action "cancel"', async () => {
      mockEnsureFolderPath.mockResolvedValue('folder-id-123')
      const { openDrivePicker } = await import('./drive')
      const onCancel = vi.fn()
      await openDrivePicker('fake-token', vi.fn(), onCancel)
      builderCalls.callback({ action: 'cancel' })
      expect(onCancel).toHaveBeenCalled()
    })

    it('loads the Picker API library only once across repeated calls', async () => {
      mockEnsureFolderPath.mockResolvedValue('folder-id-123')
      const { openDrivePicker } = await import('./drive')
      await openDrivePicker('fake-token', vi.fn(), vi.fn())
      const firstLoadCalls = mockGapi.load.mock.calls.length
      await openDrivePicker('fake-token', vi.fn(), vi.fn())
      expect(mockGapi.load.mock.calls.length).toBe(firstLoadCalls) // cached, no second load
    })

    it('throws an error if the Picker library fails to load (callback fires but PickerBuilder not available)', async () => {
      vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', 'fake-api-key')
      mockEnsureFolderPath.mockResolvedValue('folder-id-123')

      // Mock gapi.load to call the callback, but don't actually set up PickerBuilder
      const mockGapiNoPickerBuilder = {
        load: vi.fn((lib, opts) => {
          if (lib === 'picker' && opts.callback) {
            // Simulate a load that completes but doesn't set up the library
            opts.callback()
          }
        }),
        picker: undefined, // Intentionally not available
      }
      ;(window as any).gapi = mockGapiNoPickerBuilder

      const { openDrivePicker } = await import('./drive')
      await expect(openDrivePicker('fake-token', vi.fn(), vi.fn())).rejects.toThrow(/PickerBuilder not available/)

      vi.unstubAllEnvs()
      delete (window as any).gapi
    })
  })
})
