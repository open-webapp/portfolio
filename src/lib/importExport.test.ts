import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildExportableState,
  buildUnencryptedCategoriesExport,
  buildUnencryptedPortfolioExport,
  downloadCsvAsFile,
  localDateStamp,
} from './importExport'
import { initialState } from './state'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('budget backup export', () => {
  it('exports definitions, snapshots, and transactions without manual income', () => {
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: [{ id: 'income', name: 'Salary', categoryId: 'income-category', frequency: 'monthly' as const }],
      budgetExpenseAmountsByYear: { '2025': { income: 1000 } },
      budgetTransactions: [{ id: 'pay', date: '2025-01-01', description: 'Paycheck', categoryId: 'income-category', amount: 1000 }],
    }
    const exported = buildExportableState(state)
    expect(exported.budgetExpenseDefinitions).toEqual(state.budgetExpenseDefinitions)
    expect(exported.budgetTransactions).toEqual(state.budgetTransactions)
    expect(exported).not.toHaveProperty('budgetIncomeByYear')
  })
})

describe('buildUnencryptedPortfolioExport', () => {
  it('includes all fields + categoryMappings, blanks apiKeys, keeps lastRuns', () => {
    const priceLastRun = { at: '2026-08-22T12:00:00.000Z', updatedCount: 3, notFound: [] as string[] }
    const mfLastRun = { at: '2026-08-23T12:00:00.000Z', updatedCount: 1, notFound: ['VTSAX'] }
    const state = {
      ...initialState(),
      accounts: [{ id: 'a1', name: 'Checking', institution: 'Bank', accountNumber: '123', type: 'checking' as const }],
      categoryMappings: [{ id: 'm1', pattern: 'STORE', categoryId: 'c1', spendExpenseId: 'groceries' }],
      priceSync: { ...initialState().priceSync, apiKey: 'secret-poly', lastRun: priceLastRun },
      mutualFundSync: { ...initialState().mutualFundSync, apiKey: 'secret-av', lastRun: mfLastRun },
    }
    const exported = buildUnencryptedPortfolioExport(state)
    expect(exported.accounts).toEqual(state.accounts)
    expect(exported.categoryMappings).toEqual(state.categoryMappings)
    expect(exported.priceSync.apiKey).toBe('')
    expect(exported.priceSync.lastRun).toEqual(priceLastRun)
    expect(exported.mutualFundSync.apiKey).toBe('')
    expect(exported.mutualFundSync.lastRun).toEqual(mfLastRun)
    // All ExportableState fields still present.
    expect(exported).toHaveProperty('positions')
    expect(exported).toHaveProperty('transactions')
    expect(exported).toHaveProperty('snapshots')
  })

  it('handles empty arrays + null lastRuns', () => {
    const state = initialState()
    const exported = buildUnencryptedPortfolioExport(state)
    expect(exported.accounts).toEqual([])
    expect(exported.categoryMappings).toEqual([])
    expect(exported.priceSync).toEqual({ apiKey: '', lastRun: null })
    expect(exported.mutualFundSync).toEqual({ apiKey: '', lastRun: null })
  })

  it('does not mutate the input state', () => {
    const state = {
      ...initialState(),
      priceSync: { ...initialState().priceSync, apiKey: 'secret-poly' },
      mutualFundSync: { ...initialState().mutualFundSync, apiKey: 'secret-av' },
    }
    const before = JSON.parse(JSON.stringify({
      priceSync: state.priceSync,
      mutualFundSync: state.mutualFundSync,
      categoryMappings: state.categoryMappings,
    }))
    buildUnencryptedPortfolioExport(state)
    expect(state.priceSync.apiKey).toBe('secret-poly')
    expect(state.mutualFundSync.apiKey).toBe('secret-av')
    expect({
      priceSync: state.priceSync,
      mutualFundSync: state.mutualFundSync,
      categoryMappings: state.categoryMappings,
    }).toEqual(before)
  })
})

describe('buildUnencryptedCategoriesExport', () => {
  it('round-trips {categories, budgetAccountRules}', () => {
    const categories = [{ id: 'c1', name: 'Groceries' }]
    const budgetAccountRules = [
      { normalizedName: 'primary checking', displayName: 'Primary Checking', statementConvention: 'positiveSpend' as const, updatedAt: '' },
    ]
    expect(buildUnencryptedCategoriesExport(categories, budgetAccountRules)).toEqual({ categories, budgetAccountRules })
  })

  it('handles empty arrays', () => {
    expect(buildUnencryptedCategoriesExport([], [])).toEqual({ categories: [], budgetAccountRules: [] })
  })
})

describe('localDateStamp', () => {
  it('matches YYYY-MM-DD shape', () => {
    expect(localDateStamp()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('pads single-digit month and day (Jan 5 -> 01-05)', () => {
    expect(localDateStamp(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('downloadCsvAsFile', () => {
  function mockBrowserDownload() {
    const anchor = { href: '', download: '', click: vi.fn() }
    const createObjectURL = vi.fn(() => 'blob:csv')
    const revokeObjectURL = vi.fn()
    const BlobMock = vi.fn(function BlobMock() { return {} })

    vi.stubGlobal('Blob', BlobMock)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor) })

    return { anchor, createObjectURL, revokeObjectURL, BlobMock }
  }

  it('downloads CSV text through the browser file-download flow', () => {
    const browser = mockBrowserDownload()
    const csv = 'Date,Amount\n2026-01-01,42'

    downloadCsvAsFile(csv, 'expenses.csv')

    expect(browser.BlobMock).toHaveBeenCalledWith([csv], { type: 'text/csv;charset=utf-8' })
    expect(browser.createObjectURL).toHaveBeenCalledOnce()
    expect(browser.anchor.href).toBe('blob:csv')
    expect(browser.anchor.download).toBe('expenses.csv')
    expect(browser.anchor.click).toHaveBeenCalledOnce()
    expect(browser.revokeObjectURL).toHaveBeenCalledWith('blob:csv')
  })

  it('downloads header-only CSV text unchanged', () => {
    const browser = mockBrowserDownload()
    const csv = 'Date,Amount'

    downloadCsvAsFile(csv, 'empty-expenses.csv')

    expect(browser.BlobMock).toHaveBeenCalledWith([csv], { type: 'text/csv;charset=utf-8' })
  })

  it('propagates browser API failures without changing CSV text', () => {
    const csv = 'Date,Amount\n2026-01-01,42'
    const BlobMock = vi.fn(function BlobMock() { return {} })
    const createObjectURL = vi.fn(() => {
      throw new Error('object URL unavailable')
    })

    vi.stubGlobal('Blob', BlobMock)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })

    expect(() => downloadCsvAsFile(csv, 'expenses.csv')).toThrow('object URL unavailable')
    expect(BlobMock).toHaveBeenCalledWith([csv], { type: 'text/csv;charset=utf-8' })
  })
})
