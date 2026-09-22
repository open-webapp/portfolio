import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGlobalCategories } from './useGlobalCategories'

const mockLoadGlobalCategoryState = vi.fn()
const mockSaveGlobalCategoryState = vi.fn()
const mockGetLastKnownRemoteModifiedTime = vi.fn()
const mockSetLastKnownRemoteModifiedTime = vi.fn()
const mockGetSharedCategoryDriveFileId = vi.fn()

vi.mock('../lib/categoryPersist', () => ({
  loadGlobalCategoryState: (...args: unknown[]) => mockLoadGlobalCategoryState(...args),
  saveGlobalCategoryState: (...args: unknown[]) => mockSaveGlobalCategoryState(...args),
  getLastKnownRemoteModifiedTime: (...args: unknown[]) => mockGetLastKnownRemoteModifiedTime(...args),
  setLastKnownRemoteModifiedTime: (...args: unknown[]) => mockSetLastKnownRemoteModifiedTime(...args),
  getSharedCategoryDriveFileId: (...args: unknown[]) => mockGetSharedCategoryDriveFileId(...args),
}))

const mockPullGlobalCategoriesFromDrive = vi.fn()
const mockPushGlobalCategoriesToDrive = vi.fn()
const mockGetGlobalCategoriesModifiedTime = vi.fn()

vi.mock('../lib/categoryDrive', () => ({
  pullGlobalCategoriesFromDrive: (...args: unknown[]) => mockPullGlobalCategoriesFromDrive(...args),
  pushGlobalCategoriesToDrive: (...args: unknown[]) => mockPushGlobalCategoriesToDrive(...args),
  getGlobalCategoriesModifiedTime: (...args: unknown[]) => mockGetGlobalCategoriesModifiedTime(...args),
}))

const emptyState = () => ({ categories: [], budgetAccountRules: [] })

const rule = {
  id: 'r1',
  accountId: 'account-1',
  transactionType: 'expense',
  sign: -1,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const fakeDriveAuth = {} as any

describe('useGlobalCategories', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockLoadGlobalCategoryState.mockReset().mockResolvedValue(emptyState())
    mockSaveGlobalCategoryState.mockReset().mockResolvedValue(undefined)
    mockGetLastKnownRemoteModifiedTime.mockReset().mockResolvedValue(undefined)
    mockSetLastKnownRemoteModifiedTime.mockReset().mockResolvedValue(undefined)
    mockGetSharedCategoryDriveFileId.mockReset().mockResolvedValue(undefined)
    mockPullGlobalCategoriesFromDrive.mockReset().mockResolvedValue(null)
    mockPushGlobalCategoriesToDrive.mockReset().mockResolvedValue(undefined)
    mockGetGlobalCategoriesModifiedTime.mockReset().mockResolvedValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts empty and reflects hydrated state once loaded', async () => {
    const fixture = {
      categories: [{ id: 'c1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }],
      budgetAccountRules: [],
    }
    mockLoadGlobalCategoryState.mockResolvedValue(fixture)

    const { result } = renderHook(() => useGlobalCategories(null, false, null))

    expect(result.current.hydrated).toBe(false)
    expect(result.current.categories).toEqual([])

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    expect(result.current.hydrated).toBe(true)
    expect(result.current.categories).toEqual(fixture.categories)
  })

  it('debounce-saves after a dispatch post-hydration', async () => {
    const { result } = renderHook(() => useGlobalCategories(null, false, null))

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    expect(result.current.hydrated).toBe(true)

    mockSaveGlobalCategoryState.mockClear()

    act(() => {
      result.current.dispatch({ type: 'ADD_CATEGORY', id: 'c1', name: 'Groceries' })
    })

    expect(mockSaveGlobalCategoryState).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(mockSaveGlobalCategoryState).toHaveBeenCalledTimes(1)
    expect(mockSaveGlobalCategoryState).toHaveBeenCalledWith(
      expect.objectContaining({
        categories: expect.arrayContaining([expect.objectContaining({ id: 'c1', name: 'Groceries' })]),
        budgetAccountRules: [],
      })
    )
    expect('categoryMappings' in mockSaveGlobalCategoryState.mock.calls[0][0]).toBe(false)
  })

  it('pushes to drive immediately when connected, without waiting for the debounce', async () => {
    const { result } = renderHook(() => useGlobalCategories(fakeDriveAuth, true, 'proj-1'))

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    mockPushGlobalCategoriesToDrive.mockClear()

    act(() => {
      result.current.dispatch({ type: 'ADD_CATEGORY', id: 'c1', name: 'Groceries' })
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockPushGlobalCategoriesToDrive).toHaveBeenCalledTimes(1)
    expect(mockPushGlobalCategoriesToDrive).toHaveBeenCalledWith(
      fakeDriveAuth,
      'proj-1',
      expect.objectContaining({ budgetAccountRules: [] }),
      undefined
    )
    expect('categoryMappings' in mockPushGlobalCategoriesToDrive.mock.calls[0][2]).toBe(false)
  })

  it('includes dispatched rules in local saves and Drive pushes', async () => {
    const { result } = renderHook(() => useGlobalCategories(fakeDriveAuth, true, 'proj-1'))

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
      await Promise.resolve()
    })
    mockSaveGlobalCategoryState.mockClear()
    mockPushGlobalCategoriesToDrive.mockClear()

    act(() => {
      result.current.dispatch({
        type: '__REPLACE',
        state: { categories: [], budgetAccountRules: [rule] },
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(mockSaveGlobalCategoryState).toHaveBeenCalledWith(expect.objectContaining({ budgetAccountRules: [rule] }))
    expect(mockPushGlobalCategoriesToDrive).toHaveBeenCalledWith(
      fakeDriveAuth,
      'proj-1',
      expect.objectContaining({ budgetAccountRules: [rule] }),
      undefined
    )
  })

  it('ignores a legacy categoryMappings key when hydrating state', async () => {
    mockLoadGlobalCategoryState.mockResolvedValue({ categories: [], categoryMappings: [] })

    const { result } = renderHook(() => useGlobalCategories(null, false, null))

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    expect(result.current.budgetAccountRules).toEqual([])
    expect('categoryMappings' in result.current).toBe(false)
  })

  it('never pushes to drive when not connected', async () => {
    const { result } = renderHook(() => useGlobalCategories(null, false, null))

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    act(() => {
      result.current.dispatch({ type: 'ADD_CATEGORY', id: 'c1', name: 'Groceries' })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(mockPushGlobalCategoriesToDrive).not.toHaveBeenCalled()
    expect(mockSaveGlobalCategoryState).toHaveBeenCalledTimes(1)
  })

  it('runs an initial pull+merge exactly once when driveConnected flips true post-hydrate', async () => {
    const localFixture = {
      categories: [{ id: 'c1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }],
      budgetAccountRules: [],
    }
    mockLoadGlobalCategoryState.mockResolvedValue(localFixture)

    const remoteFixture = {
      categories: [{ id: 'c1', name: 'Groceries (renamed)', updatedAt: '2026-02-01T00:00:00.000Z' }],
      budgetAccountRules: [],
    }
    mockPullGlobalCategoriesFromDrive.mockResolvedValue(remoteFixture)

    const { result, rerender } = renderHook(
      ({ driveConnected }: { driveConnected: boolean }) => useGlobalCategories(fakeDriveAuth, driveConnected, 'proj-1'),
      { initialProps: { driveConnected: false } }
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    expect(result.current.hydrated).toBe(true)

    rerender({ driveConnected: true })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockPullGlobalCategoriesFromDrive).toHaveBeenCalledTimes(1)
    expect(result.current.categories[0].name).toBe('Groceries (renamed)')

    // Flip a second time — should not re-trigger the initial pull.
    rerender({ driveConnected: false })
    rerender({ driveConnected: true })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockPullGlobalCategoriesFromDrive).toHaveBeenCalledTimes(1)
  })

  it('polls every 60s and pulls only when the remote modifiedTime is newer', async () => {
    mockGetLastKnownRemoteModifiedTime.mockResolvedValue('2026-01-01T00:00:00.000Z')

    const { result } = renderHook(() => useGlobalCategories(fakeDriveAuth, true, 'proj-1'))

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    expect(result.current.hydrated).toBe(true)

    // Initial pull effect will also fire once — clear counters after it settles.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    mockPullGlobalCategoriesFromDrive.mockClear()
    mockGetGlobalCategoriesModifiedTime.mockClear()

    mockGetGlobalCategoriesModifiedTime.mockResolvedValue('2026-03-01T00:00:00.000Z')
    mockPullGlobalCategoriesFromDrive.mockResolvedValue({
      categories: [{ id: 'c2', name: 'From poll', updatedAt: '2026-03-01T00:00:00.000Z' }],
      budgetAccountRules: [],
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockPullGlobalCategoriesFromDrive).toHaveBeenCalledTimes(1)
    expect(mockGetGlobalCategoriesModifiedTime).toHaveBeenCalledWith(fakeDriveAuth, 'proj-1', undefined)
    expect(mockPullGlobalCategoriesFromDrive).toHaveBeenCalledWith(fakeDriveAuth, 'proj-1', undefined)
    expect(mockSetLastKnownRemoteModifiedTime).toHaveBeenCalledWith('2026-03-01T00:00:00.000Z')

    mockPullGlobalCategoriesFromDrive.mockClear()
    // Second tick, unchanged modifiedTime relative to what we just set as the bookmark.
    mockGetLastKnownRemoteModifiedTime.mockResolvedValue('2026-03-01T00:00:00.000Z')
    mockGetGlobalCategoriesModifiedTime.mockResolvedValue('2026-03-01T00:00:00.000Z')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockPullGlobalCategoriesFromDrive).not.toHaveBeenCalled()
  })

  it('retains local rules when a poll cannot load remote state', async () => {
    mockLoadGlobalCategoryState.mockResolvedValue({ categories: [], budgetAccountRules: [rule] })
    mockGetLastKnownRemoteModifiedTime.mockResolvedValue('2026-01-01T00:00:00.000Z')
    mockGetGlobalCategoriesModifiedTime.mockResolvedValue('2026-03-01T00:00:00.000Z')
    mockPullGlobalCategoriesFromDrive.mockResolvedValue(null)

    const { result } = renderHook(() => useGlobalCategories(fakeDriveAuth, true, 'proj-1'))

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(result.current.budgetAccountRules).toEqual([rule])
  })

  it('(bug-reveal) never pushes to Drive before the initial pull has resolved, so it cannot clobber a remote-only category', async () => {
    const localFixture = {
      categories: [{ id: 'c1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }],
      budgetAccountRules: [],
    }
    mockLoadGlobalCategoryState.mockResolvedValue(localFixture)

    // The pull is slow (e.g. a real network round-trip) and resolves with a
    // category that only exists on Drive, added by another browser.
    let resolvePull: (v: unknown) => void
    mockPullGlobalCategoriesFromDrive.mockImplementation(
      () => new Promise((resolve) => { resolvePull = resolve })
    )

    renderHook(() => useGlobalCategories(fakeDriveAuth, true, 'proj-1'))

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Pull is in flight but hasn't resolved yet — the push effect must NOT
    // have fired, or it would overwrite Drive with local-only data and
    // permanently lose the remote category the pull is about to bring in.
    expect(mockPushGlobalCategoriesToDrive).not.toHaveBeenCalled()

    await act(async () => {
      resolvePull!({
        categories: [...localFixture.categories, { id: 'c2', name: 'Dining', updatedAt: '2026-03-01T00:00:00.000Z' }],
        budgetAccountRules: [],
      })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockPushGlobalCategoriesToDrive).toHaveBeenCalledWith(
      fakeDriveAuth,
      'proj-1',
      expect.objectContaining({ categories: expect.arrayContaining([expect.objectContaining({ id: 'c2' })]) }),
      undefined
    )
  })

  it('threads a persisted shared file ID through push, pull, and polling', async () => {
    mockGetSharedCategoryDriveFileId.mockResolvedValue('shared-file-1')
    mockGetLastKnownRemoteModifiedTime.mockResolvedValue('2026-01-01T00:00:00.000Z')
    mockGetGlobalCategoriesModifiedTime.mockResolvedValue('2026-03-01T00:00:00.000Z')
    mockPullGlobalCategoriesFromDrive.mockResolvedValue(emptyState())

    const { result } = renderHook(() => useGlobalCategories(fakeDriveAuth, true, 'proj-1'))

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockPullGlobalCategoriesFromDrive).toHaveBeenCalledWith(fakeDriveAuth, 'proj-1', 'shared-file-1')

    mockPushGlobalCategoriesToDrive.mockClear()
    mockGetGlobalCategoriesModifiedTime.mockClear()
    mockPullGlobalCategoriesFromDrive.mockClear()
    act(() => {
      result.current.dispatch({ type: 'ADD_CATEGORY', id: 'c1', name: 'Groceries' })
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(mockPushGlobalCategoriesToDrive).toHaveBeenCalledWith(
      fakeDriveAuth,
      'proj-1',
      expect.any(Object),
      'shared-file-1'
    )
    expect(mockGetGlobalCategoriesModifiedTime).toHaveBeenCalledWith(fakeDriveAuth, 'proj-1', 'shared-file-1')
    expect(mockPullGlobalCategoriesFromDrive).toHaveBeenCalledWith(fakeDriveAuth, 'proj-1', 'shared-file-1')
  })

  it('refreshes the shared file ID before subsequent push and poll cycles', async () => {
    mockGetSharedCategoryDriveFileId.mockResolvedValue(undefined)
    mockGetLastKnownRemoteModifiedTime.mockResolvedValue('2026-01-01T00:00:00.000Z')
    mockGetGlobalCategoriesModifiedTime.mockResolvedValue('2026-03-01T00:00:00.000Z')
    mockPullGlobalCategoriesFromDrive.mockResolvedValue(emptyState())

    const { result } = renderHook(() => useGlobalCategories(fakeDriveAuth, true, 'proj-1'))
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
      await Promise.resolve()
    })
    mockPushGlobalCategoriesToDrive.mockClear()
    mockGetGlobalCategoriesModifiedTime.mockClear()
    mockGetSharedCategoryDriveFileId.mockResolvedValue('shared-file-2')

    act(() => {
      result.current.dispatch({ type: 'ADD_CATEGORY', id: 'c1', name: 'Groceries' })
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(mockPushGlobalCategoriesToDrive).toHaveBeenCalledWith(fakeDriveAuth, 'proj-1', expect.any(Object), 'shared-file-2')
    expect(mockGetGlobalCategoriesModifiedTime).toHaveBeenCalledWith(fakeDriveAuth, 'proj-1', 'shared-file-2')
  })

  it('retains local state when pulling an invalid shared file ID fails', async () => {
    mockLoadGlobalCategoryState.mockResolvedValue({ categories: [], budgetAccountRules: [rule] })
    mockGetSharedCategoryDriveFileId.mockResolvedValue('stale-file')
    mockPullGlobalCategoriesFromDrive.mockResolvedValue(null)

    const { result } = renderHook(() => useGlobalCategories(fakeDriveAuth, true, 'proj-1'))
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockPullGlobalCategoriesFromDrive).toHaveBeenCalledWith(fakeDriveAuth, 'proj-1', 'stale-file')
    expect(result.current.budgetAccountRules).toEqual([rule])
  })

  it('retains the picker-saved local state when a revoked shared-file poll is swallowed by the Drive layer', async () => {
    const pickerSavedState = {
      categories: [{ id: 'shared-category', name: 'Shared category', updatedAt: '2026-03-01T00:00:00.000Z' }],
      budgetAccountRules: [],
    }
    mockLoadGlobalCategoryState.mockResolvedValue(pickerSavedState)
    mockGetSharedCategoryDriveFileId.mockResolvedValue('shared-file-1')
    mockGetLastKnownRemoteModifiedTime.mockResolvedValue('2026-01-01T00:00:00.000Z')
    // categoryDrive converts inaccessible/stale file metadata into null.
    mockGetGlobalCategoriesModifiedTime.mockResolvedValue(null)

    const { result } = renderHook(() => useGlobalCategories(fakeDriveAuth, true, 'proj-1'))

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockGetGlobalCategoriesModifiedTime).toHaveBeenCalledWith(fakeDriveAuth, 'proj-1', 'shared-file-1')
    expect(result.current.categories).toEqual(pickerSavedState.categories)
  })

  it('hydrates the picker-saved state before merging the same shared file without a duplicate local save', async () => {
    const pickerSavedState = {
      categories: [{ id: 'shared-category', name: 'Shared category', updatedAt: '2026-03-01T00:00:00.000Z' }],
      budgetAccountRules: [],
    }
    mockLoadGlobalCategoryState.mockResolvedValue(pickerSavedState)
    mockGetSharedCategoryDriveFileId.mockResolvedValue('shared-file-1')
    mockPullGlobalCategoriesFromDrive.mockResolvedValue(pickerSavedState)

    const { result } = renderHook(() => useGlobalCategories(fakeDriveAuth, true, 'proj-1'))

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockLoadGlobalCategoryState).toHaveBeenCalledWith()
    expect(mockPullGlobalCategoriesFromDrive).toHaveBeenCalledWith(fakeDriveAuth, 'proj-1', 'shared-file-1')
    expect(result.current.categories).toEqual(pickerSavedState.categories)
    expect(mockSaveGlobalCategoryState).toHaveBeenCalledTimes(1)
  })

  it('syncNow pulls+merges remote categories on demand, for use after a manual Drive sync', async () => {
    const localFixture = {
      categories: [{ id: 'c1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }],
      budgetAccountRules: [],
    }
    mockLoadGlobalCategoryState.mockResolvedValue(localFixture)

    const { result } = renderHook(() => useGlobalCategories(fakeDriveAuth, true, 'proj-1'))

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.hydrated).toBe(true)

    // Initial pull already ran (and found nothing new) — simulate a category
    // that landed on Drive from another browser since then.
    mockPullGlobalCategoriesFromDrive.mockClear()
    mockPullGlobalCategoriesFromDrive.mockResolvedValue({
      categories: [{ id: 'c1', name: 'Food', updatedAt: '2026-03-01T00:00:00.000Z' }],
      budgetAccountRules: [],
    })

    await act(async () => {
      await result.current.syncNow()
    })

    expect(result.current.categories[0].name).toBe('Food')
  })

  it('excludes tombstoned categories from hook output', async () => {
    const fixture = {
      categories: [
        { id: 'c1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'c2', name: 'Deleted Cat', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: '2026-01-02T00:00:00.000Z' },
      ],
      budgetAccountRules: [],
    }
    mockLoadGlobalCategoryState.mockResolvedValue(fixture)

    const { result } = renderHook(() => useGlobalCategories(null, false, null))

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    expect(result.current.categories).toHaveLength(1)
    expect(result.current.categories[0].id).toBe('c1')
  })
})
