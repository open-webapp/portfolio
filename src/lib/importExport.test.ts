import { describe, it, expect, vi, afterEach } from 'vitest'
import { initialState, type AppState } from './state'
import {
  buildExportableState,
  exportBackup,
  downloadEnvelopeAsFile,
  downloadJsonAsFile,
  parseImportFile,
  decryptImportEnvelope,
  getEnvelopeSaltBytes,
  ImportDecryptError,
  ImportMalformedFileError,
  parseCategoryMappingImportFile,
  CategoryMappingImportError,
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
    budgetIncomeByYear: { '2024': 4500 },
    budgetExpenseDefinitions: [{ id: 'exp1', name: 'Rent', categoryId: 'cat1', frequency: 'monthly' }],
    budgetExpenseAmountsByYear: { '2024': { exp1: 1800 } },
    budgetTransactions: [{ id: 'btx1', date: '2024-01-05', description: 'Groceries', categoryId: 'cat1', amount: 120.5 }],
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
    expect(result.budgetIncomeByYear).toBe(state.budgetIncomeByYear)
    expect(result.budgetExpenseDefinitions).toBe(state.budgetExpenseDefinitions)
    expect(result.budgetExpenseAmountsByYear).toBe(state.budgetExpenseAmountsByYear)
    expect(result.budgetTransactions).toBe(state.budgetTransactions)

    expect(result.priceSync).toEqual({ apiKey: 'price-api-key', lastRun: state.priceSync.lastRun })
    expect(result.mutualFundSync).toEqual({ apiKey: 'mf-api-key', lastRun: state.mutualFundSync.lastRun })

    expect(Object.keys(result).sort()).toEqual(
      [
        'accounts',
        'balanceEntries',
        'budgetExpenseAmountsByYear',
        'budgetExpenseDefinitions',
        'budgetIncomeByYear',
        'budgetTransactions',
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

describe('downloadJsonAsFile', () => {
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

    downloadJsonAsFile({ categories: [], categoryMappings: [] }, 'categories.json')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob)
    expect(anchor.download).toBe('categories.json')
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

describe('getEnvelopeSaltBytes', () => {
  it('decodes the envelope salt to bytes that round-trip back to the original base64', async () => {
    const state = populatedState()
    const salt = generateSalt()
    const key = await deriveKey('correct horse battery staple', salt)
    const envelope = await exportBackup(state, key, salt)

    const saltBytes = getEnvelopeSaltBytes(envelope)
    const roundTripped = btoa(String.fromCharCode(...saltBytes))
    expect(roundTripped).toBe(envelope.salt)
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

  it('round-trips all budget fields (including budget transactions and multiple years) exactly', async () => {
    const state = populatedState()
    state.budgetIncomeByYear = {
      '2023': 4000,
      '2024': 4500,
    }
    state.budgetExpenseDefinitions = [
      { id: 'exp0', name: 'Rent', categoryId: 'cat1', frequency: 'monthly' },
    ]
    state.budgetExpenseAmountsByYear = {
      '2023': { exp0: 1700 },
      '2024': { exp0: 1800 },
    }
    const salt = generateSalt()
    const key = await deriveKey('correct horse battery staple', salt)
    const envelope = await exportBackup(state, key, salt)

    const result = await decryptImportEnvelope(envelope, 'correct horse battery staple')
    expect(result.budgetIncomeByYear).toEqual({
      '2023': 4000,
      '2024': 4500,
    })
    expect(result.budgetExpenseDefinitions).toEqual([
      { id: 'exp0', name: 'Rent', categoryId: 'cat1', frequency: 'monthly' },
    ])
    expect(result.budgetExpenseAmountsByYear).toEqual({
      '2023': { exp0: 1700 },
      '2024': { exp0: 1800 },
    })
    expect(result.budgetTransactions).toEqual([{ id: 'btx1', date: '2024-01-05', description: 'Groceries', categoryId: 'cat1', amount: 120.5 }])
  })

  it('defaults budgetTransactions to [] for a legacy backup missing the field', async () => {
    const salt = generateSalt()
    const key = await deriveKey('correct horse battery staple', salt)
    // Simulate a pre-budget-transactions backup missing all budget fields
    // entirely, built directly rather than via buildExportableState.
    const legacy: Partial<ExportableState> = {
      accounts: [],
      positions: [],
      closedPositions: [],
      transactions: [],
      snapshots: [],
      csvMappings: [],
      customInstitutions: [],
      balanceEntries: [],
      // budgetIncomeByYear, budgetExpenseDefinitions,
      // budgetExpenseAmountsByYear, budgetTransactions intentionally omitted
      priceSync: { apiKey: '', lastRun: null },
      mutualFundSync: { apiKey: '', lastRun: null },
    }
    const envelope = await encryptState(legacy as unknown as AppState, key, salt)

    const result = await decryptImportEnvelope(envelope, 'correct horse battery staple')
    expect(result.budgetIncomeByYear).toEqual({})
    expect(result.budgetExpenseDefinitions).toEqual([])
    expect(result.budgetExpenseAmountsByYear).toEqual({})
    expect(result.budgetTransactions).toEqual([])
  })

  it('ignores a legacy budgetCategories key present in an old export without erroring', async () => {
    const salt = generateSalt()
    const key = await deriveKey('correct horse battery staple', salt)
    // Simulate an old export file that still has the now-removed
    // budgetCategories field.
    const legacy = {
      accounts: [],
      positions: [],
      closedPositions: [],
      transactions: [],
      snapshots: [],
      csvMappings: [],
      customInstitutions: [],
      balanceEntries: [],
      budgetIncomeMonthly: 0,
      budgetIncomeYearly: 0,
      budgetExpenses: [],
      budgetCategories: ['Housing', 'Food'],
      priceSync: { apiKey: '', lastRun: null },
      mutualFundSync: { apiKey: '', lastRun: null },
    }
    const envelope = await encryptState(legacy as unknown as AppState, key, salt)

    const result = await decryptImportEnvelope(envelope, 'correct horse battery staple')
    expect(result.budgetTransactions).toEqual([])
    expect(result).not.toHaveProperty('budgetCategories')
  })

  it('restores an OLD-shape export (pre-year-independent budgetExpensesByYear/{monthly,yearly} income) with empty defaults for the renamed fields, no migration', async () => {
    const salt = generateSalt()
    const key = await deriveKey('correct horse battery staple', salt)
    // Old export shape: budgetExpensesByYear: Record<string, Expense[]> and
    // budgetIncomeByYear: Record<string, {monthly, yearly}> — both renamed
    // away in the year-independent refactor. No budgetExpenseDefinitions/
    // budgetExpenseAmountsByYear keys, and budgetIncomeByYear is the old
    // object shape rather than a plain number.
    const oldShape = {
      accounts: [],
      positions: [],
      closedPositions: [],
      transactions: [],
      snapshots: [],
      csvMappings: [],
      customInstitutions: [],
      balanceEntries: [],
      budgetIncomeByYear: { '2024': { monthly: 4500, yearly: 0 } },
      budgetExpensesByYear: { '2024': [{ id: 'exp1', name: 'Rent', categoryId: 'cat1', amount: 1800, frequency: 'monthly' }] },
      budgetTransactions: [],
      priceSync: { apiKey: '', lastRun: null },
      mutualFundSync: { apiKey: '', lastRun: null },
    }
    const envelope = await encryptState(oldShape as unknown as AppState, key, salt)

    const result = await decryptImportEnvelope(envelope, 'correct horse battery staple')
    // No migration logic exists: the old-shape budgetIncomeByYear value is
    // passed through as-is (it's present, so `??` doesn't default it), while
    // the renamed budgetExpenseDefinitions/budgetExpenseAmountsByYear fields
    // (absent under their old names) fall back to empty defaults.
    expect(result.budgetIncomeByYear).toEqual({ '2024': { monthly: 4500, yearly: 0 } })
    expect(result.budgetExpenseDefinitions).toEqual([])
    expect(result.budgetExpenseAmountsByYear).toEqual({})
  })
})

describe('parseCategoryMappingImportFile', () => {
  it('parses valid spendExpenseId-keyed category-mapping JSON', () => {
    const data = {
      categories: [{ id: 'cat1', name: 'Food' }],
      categoryMappings: [{ id: 'cm1', substring: 'grocer', spendExpenseId: 'exp1', updatedAt: '2024-01-01T00:00:00.000Z' }],
    }
    const result = parseCategoryMappingImportFile(JSON.stringify(data))
    expect(result).toEqual(data)
  })

  it('strips a stale categoryId residue when both keys are present (spendExpenseId is authoritative)', () => {
    const data = {
      categories: [],
      categoryMappings: [
        { id: 'cm1', substring: 'grocer', categoryId: 'cat1', spendExpenseId: 'exp1', updatedAt: '2024-01-01T00:00:00.000Z' },
      ],
    }
    const result = parseCategoryMappingImportFile(JSON.stringify(data))
    expect(result.categoryMappings).toEqual([
      { id: 'cm1', substring: 'grocer', spendExpenseId: 'exp1', updatedAt: '2024-01-01T00:00:00.000Z' },
    ])
    expect('categoryId' in result.categoryMappings[0]).toBe(false)
  })

  it('migrates a legacy categoryId-only row via resolveSpendExpenseForCategory when definitions are in scope', () => {
    const data = {
      categories: [],
      categoryMappings: [{ id: 'cm1', substring: 'grocer', categoryId: 'cat1', updatedAt: '2024-01-01T00:00:00.000Z' }],
    }
    const result = parseCategoryMappingImportFile(JSON.stringify(data), [
      { id: 'exp1', name: 'Groceries', categoryId: 'cat1', frequency: 'monthly' },
    ])
    expect(result.categoryMappings).toEqual([
      { id: 'cm1', substring: 'grocer', spendExpenseId: 'exp1', updatedAt: '2024-01-01T00:00:00.000Z' },
    ])
  })

  it('drops a legacy categoryId-only row with no matching definition', () => {
    const data = {
      categories: [],
      categoryMappings: [{ id: 'cm1', substring: 'grocer', categoryId: 'cat-gone', updatedAt: '2024-01-01T00:00:00.000Z' }],
    }
    const result = parseCategoryMappingImportFile(JSON.stringify(data), [
      { id: 'exp1', name: 'Groceries', categoryId: 'cat1', frequency: 'monthly' },
    ])
    expect(result.categoryMappings).toEqual([])
  })

  it('drops legacy categoryId-only rows when no definitions are in scope', () => {
    const data = {
      categories: [],
      categoryMappings: [{ id: 'cm1', substring: 'grocer', categoryId: 'cat1', updatedAt: '2024-01-01T00:00:00.000Z' }],
    }
    const result = parseCategoryMappingImportFile(JSON.stringify(data))
    expect(result.categoryMappings).toEqual([])
  })

  it('parses an empty-but-valid categories/categoryMappings payload fine', () => {
    const result = parseCategoryMappingImportFile(JSON.stringify({ categories: [], categoryMappings: [] }))
    expect(result).toEqual({ categories: [], categoryMappings: [] })
  })

  it('throws CategoryMappingImportError on non-JSON text', () => {
    expect(() => parseCategoryMappingImportFile('not json at all {{{')).toThrow(CategoryMappingImportError)
  })

  it('throws CategoryMappingImportError when the categories key is missing', () => {
    expect(() => parseCategoryMappingImportFile(JSON.stringify({ categoryMappings: [] }))).toThrow(
      CategoryMappingImportError
    )
  })

  it('throws CategoryMappingImportError when the categoryMappings key is missing', () => {
    expect(() => parseCategoryMappingImportFile(JSON.stringify({ categories: [] }))).toThrow(CategoryMappingImportError)
  })

  it('throws CategoryMappingImportError when a category entry is missing required keys', () => {
    const data = { categories: [{ id: 'cat1' }], categoryMappings: [] }
    expect(() => parseCategoryMappingImportFile(JSON.stringify(data))).toThrow(CategoryMappingImportError)
  })

  it('throws CategoryMappingImportError when a mapping entry is missing required keys', () => {
    const data = { categories: [], categoryMappings: [{ id: 'cm1', substring: 'grocer' }] }
    expect(() => parseCategoryMappingImportFile(JSON.stringify(data))).toThrow(CategoryMappingImportError)
  })
})
