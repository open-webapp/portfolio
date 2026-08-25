import { describe, it, expect, vi, afterEach } from 'vitest'
import { initialState, type AppState } from './state'
import {
  buildExportableState,
  exportBackup,
  downloadEnvelopeAsFile,
  parseImportFile,
  decryptImportEnvelope,
  ImportDecryptError,
  ImportMalformedFileError,
} from './importExport'
import { deriveKey, decryptState, encryptState, generateSalt } from './crypto'
import type { ExportableState } from './importExport'

function populatedState(): AppState {
  const base = initialState()
  const populated: AppState = {
    ...base,
    accounts: [
      { id: 'acc1', accountNumber: '123', name: 'Brokerage', institution: 'Fidelity', taxCategory: 'taxable', retirement: false, createdAt: '2024-01-01T00:00:00.000Z' },
    ],
    positions: [
      { id: 'pos1', accountId: 'acc1', symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', shares: 10, avgCost: 100, price: 200, lastImportedAt: '2024-01-01T00:00:00.000Z' },
    ],
    closedPositions: [
      { id: 'cp1', accountId: 'acc1', symbol: 'MSFT', name: 'Microsoft', closedDate: '2024-02-01', assetClass: 'Equity', shares: 5, avgCost: 50, price: 60, lastImportedAt: '2024-02-01T00:00:00.000Z', realizedGL: 50, realizedGLBasis: 'transactions' },
    ],
    transactions: [
      { id: 'tx1', accountId: 'acc1', date: '2024-01-01', symbol: 'AAPL', type: 'Buy', shares: 10, price: 100, amount: 1000, importedAt: '2024-01-01T00:00:00.000Z' },
    ],
    snapshots: [
      { id: 'snap1', accountId: 'acc1', date: '2024-01-01', value: 2000 },
    ],
    csvMappings: [
      { id: 'map1', accountId: 'acc1', kind: 'positions', fieldMap: { Symbol: 'symbol' }, updatedAt: '2024-01-01T00:00:00.000Z' },
    ],
    customInstitutions: ['Custom Bank'],
    balanceEntries: [
      { id: 'bal1', accountId: 'acc1', date: '2024-01-01', balance: 5000, activities: [{ type: 'Contribution', amount: 100, note: 'note' }] },
    ],
    priceSync: {
      apiKey: 'price-api-key',
      lastFetchedDate: '2024-03-01',
      heldPrices: { AAPL: { price: 200, date: '2024-03-01', fetchedAt: '2024-03-01T00:00:00.000Z' } },
      lastRun: { at: '2024-03-01T00:00:00.000Z', updatedCount: 1, notFound: [], marketTickerCount: 100 },
    },
    mutualFundSync: {
      apiKey: 'mf-api-key',
      heldPrices: { VTSAX: { price: 100, date: '2024-03-01', fetchedAt: '2024-03-01T00:00:00.000Z' } },
      lastRun: { at: '2024-03-01T00:00:00.000Z', updatedCount: 1, notFound: [], marketTickerCount: 0 },
      callBudget: { date: '2024-03-01', callsUsed: 3 },
    },
    view: 'settings',
    selectedAccountId: 'acc1',
    pendingImport: { kind: 'positions', profileId: 'map1', rows: [{ Symbol: 'AAPL' }], fileName: 'in.csv' },
  }
  return populated
}

describe('buildExportableState', () => {
  it('picks exactly the exportable fields, excluding cache and UI state', () => {
    const state = populatedState()
    const result = buildExportableState(state)

    expect(result.accounts).toBe(state.accounts)
    expect(result.positions).toBe(state.positions)
    expect(result.closedPositions).toBe(state.closedPositions)
    expect(result.transactions).toBe(state.transactions)
    expect(result.snapshots).toBe(state.snapshots)
    expect(result.csvMappings).toBe(state.csvMappings)
    expect(result.customInstitutions).toBe(state.customInstitutions)
    expect(result.balanceEntries).toBe(state.balanceEntries)

    expect(result.priceSync).toEqual({ apiKey: 'price-api-key', lastRun: state.priceSync.lastRun })
    expect(result.mutualFundSync).toEqual({ apiKey: 'mf-api-key', lastRun: state.mutualFundSync.lastRun })

    expect(Object.keys(result).sort()).toEqual(
      [
        'accounts',
        'balanceEntries',
        'closedPositions',
        'csvMappings',
        'customInstitutions',
        'mutualFundSync',
        'positions',
        'priceSync',
        'snapshots',
        'transactions',
      ].sort()
    )
    expect(Object.keys(result.priceSync).sort()).toEqual(['apiKey', 'lastRun'])
    expect(Object.keys(result.mutualFundSync).sort()).toEqual(['apiKey', 'lastRun'])

    // No cache fields anywhere
    const json = JSON.stringify(result)
    expect(json).not.toContain('heldPrices')
    expect(json).not.toContain('lastFetchedDate')
    expect(json).not.toContain('callBudget')

    // No UI-state fields
    expect(result).not.toHaveProperty('view')
    expect(result).not.toHaveProperty('sortKey')
    expect(result).not.toHaveProperty('sortDir')
    expect(result).not.toHaveProperty('txTypeFilter')
    expect(result).not.toHaveProperty('txSearch')
    expect(result).not.toHaveProperty('selectedAccountId')
    expect(result).not.toHaveProperty('selectedCategoryKey')
    expect(result).not.toHaveProperty('expandedCategories')
    expect(result).not.toHaveProperty('acctAssetClassFilter')
    expect(result).not.toHaveProperty('acctPosSearch')
    expect(result).not.toHaveProperty('regAccountId')
    expect(result).not.toHaveProperty('regExpanded')
    expect(result).not.toHaveProperty('regActivityFilter')
    expect(result).not.toHaveProperty('pendingImport')
  })
})

describe('exportBackup', () => {
  it('encrypts the exportable state into a decryptable envelope', async () => {
    const state = populatedState()
    const salt = generateSalt()
    const key = await deriveKey('correct horse battery staple', salt)

    const envelope = await exportBackup(state, key, salt)

    expect(envelope.version).toBe(1)
    expect(typeof envelope.salt).toBe('string')
    expect(typeof envelope.iv).toBe('string')
    expect(typeof envelope.ciphertext).toBe('string')

    const decrypted = (await decryptState(envelope, key)) as unknown as ExportableState
    expect(decrypted).toEqual(buildExportableState(state))
  })
})

describe('downloadEnvelopeAsFile', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates an object URL for a Blob, downloads it via an anchor, then revokes the URL', () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    // jsdom doesn't implement these
    // @ts-expect-error partial stub for test
    URL.createObjectURL = createObjectURL
    // @ts-expect-error partial stub for test
    URL.revokeObjectURL = revokeObjectURL

    const clickSpy = vi.fn()
    const anchor = document.createElement('a')
    vi.spyOn(anchor, 'click').mockImplementation(clickSpy)
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(anchor)

    const envelope = { version: 1 as const, salt: 's', iv: 'i', ciphertext: 'c' }
    downloadEnvelopeAsFile(envelope, 'backup.json')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob)
    expect(anchor.download).toBe('backup.json')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')

    createElementSpy.mockRestore()
  })
})

describe('parseImportFile', () => {
  it('returns the parsed envelope for valid envelope JSON', async () => {
    const state = populatedState()
    const salt = generateSalt()
    const key = await deriveKey('correct horse battery staple', salt)
    const envelope = await exportBackup(state, key, salt)

    const result = parseImportFile(JSON.stringify(envelope))
    expect(result).toEqual(envelope)
  })

  it('throws ImportMalformedFileError on non-JSON garbage', () => {
    expect(() => parseImportFile('not json at all {{{')).toThrow(ImportMalformedFileError)
  })

  it('throws ImportMalformedFileError on valid JSON that is not envelope-shaped', () => {
    expect(() => parseImportFile(JSON.stringify({ foo: 'bar' }))).toThrow(ImportMalformedFileError)
    // legacy-plaintext-shaped blob (a raw AppState, not an envelope)
    expect(() => parseImportFile(JSON.stringify({ accounts: [], positions: [] }))).toThrow(ImportMalformedFileError)
  })
})

describe('decryptImportEnvelope', () => {
  it('decrypts with the correct password back into the original ExportableState', async () => {
    const state = populatedState()
    const salt = generateSalt()
    const key = await deriveKey('correct horse battery staple', salt)
    const envelope = await exportBackup(state, key, salt)

    const result = await decryptImportEnvelope(envelope, 'correct horse battery staple')
    expect(result).toEqual(buildExportableState(state))
  })

  it('throws ImportDecryptError (not a raw OperationError) on wrong password', async () => {
    const state = populatedState()
    const salt = generateSalt()
    const key = await deriveKey('correct horse battery staple', salt)
    const envelope = await exportBackup(state, key, salt)

    await expect(decryptImportEnvelope(envelope, 'wrong password')).rejects.toThrow(ImportDecryptError)
  })

  it('coalesces missing fields from an older/partial export to their defaults', async () => {
    const salt = generateSalt()
    const key = await deriveKey('correct horse battery staple', salt)
    // Simulate an older export missing the `snapshots` key entirely, built
    // directly rather than via buildExportableState.
    const partial = {
      accounts: [],
      positions: [],
      closedPositions: [],
      transactions: [],
      // snapshots intentionally omitted
      csvMappings: [],
      customInstitutions: [],
      balanceEntries: [],
      priceSync: { apiKey: '', lastRun: null },
      mutualFundSync: { apiKey: '', lastRun: null },
    }
    const envelope = await encryptState(partial as unknown as AppState, key, salt)

    const result = await decryptImportEnvelope(envelope, 'correct horse battery staple')
    expect(result.snapshots).toEqual([])
    expect(result.snapshots).not.toBeUndefined()
  })
})
