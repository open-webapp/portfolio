import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildExportableState, downloadCsvAsFile } from './importExport'
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
