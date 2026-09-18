import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGlobalCategories } from './useGlobalCategories'
import type { GlobalCategoryState } from '../lib/categoryStore'

const mockLoadGlobalCategoryState = vi.fn()
const mockSaveGlobalCategoryState = vi.fn()
const mockGetLastKnownRemoteModifiedTime = vi.fn()
const mockSetLastKnownRemoteModifiedTime = vi.fn()

vi.mock('../lib/categoryPersist', () => ({
  loadGlobalCategoryState: (...args: unknown[]) => mockLoadGlobalCategoryState(...args),
  saveGlobalCategoryState: (...args: unknown[]) => mockSaveGlobalCategoryState(...args),
  getLastKnownRemoteModifiedTime: (...args: unknown[]) => mockGetLastKnownRemoteModifiedTime(...args),
  setLastKnownRemoteModifiedTime: (...args: unknown[]) => mockSetLastKnownRemoteModifiedTime(...args),
}))

const mockPullGlobalCategoriesFromDrive = vi.fn()
const mockPushGlobalCategoriesToDrive = vi.fn()
const mockGetGlobalCategoriesModifiedTime = vi.fn()

vi.mock('../lib/categoryDrive', () => ({
  pullGlobalCategoriesFromDrive: (...args: unknown[]) => mockPullGlobalCategoriesFromDrive(...args),
  pushGlobalCategoriesToDrive: (...args: unknown[]) => mockPushGlobalCategoriesToDrive(...args),
  getGlobalCategoriesModifiedTime: (...args: unknown[]) => mockGetGlobalCategoriesModifiedTime(...args),
}))

const mockSeedGlobalCategoriesIfNeeded = vi.fn()

vi.mock('../lib/categoryMigration', () => ({
  seedGlobalCategoriesIfNeeded: (...args: unknown[]) => mockSeedGlobalCategoriesIfNeeded(...args),
}))

const emptyState = (): GlobalCategoryState => ({ categories: [], categoryMappings: [] })

const fakeDriveAuth = {} as any

describe('useGlobalCategories', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockLoadGlobalCategoryState.mockReset().mockResolvedValue(emptyState())
    mockSaveGlobalCategoryState.mockReset().mockResolvedValue(undefined)
    mockGetLastKnownRemoteModifiedTime.mockReset().mockResolvedValue(undefined)
    mockSetLastKnownRemoteModifiedTime.mockReset().mockResolvedValue(undefined)
    mockPullGlobalCategoriesFromDrive.mockReset().mockResolvedValue(null)
    mockPushGlobalCategoriesToDrive.mockReset().mockResolvedValue(undefined)
    mockGetGlobalCategoriesModifiedTime.mockReset().mockResolvedValue(null)
    mockSeedGlobalCategoriesIfNeeded.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts empty and reflects hydrated state once loaded', async () => {
    const fixture: GlobalCategoryState = {
      categories: [{ id: 'c1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }],
      categoryMappings: [],
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
      })
    )
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
    const localFixture: GlobalCategoryState = {
      categories: [{ id: 'c1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }],
      categoryMappings: [],
    }
    mockLoadGlobalCategoryState.mockResolvedValue(localFixture)

    const remoteFixture: GlobalCategoryState = {
      categories: [{ id: 'c1', name: 'Groceries (renamed)', updatedAt: '2026-02-01T00:00:00.000Z' }],
      categoryMappings: [],
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
      categoryMappings: [],
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockPullGlobalCategoriesFromDrive).toHaveBeenCalledTimes(1)
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

  it('syncNow pulls+merges remote mappings on demand, for use after a manual Drive sync', async () => {
    const localFixture: GlobalCategoryState = {
      categories: [{ id: 'c1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }],
      categoryMappings: [],
    }
    mockLoadGlobalCategoryState.mockResolvedValue(localFixture)

    const { result } = renderHook(() => useGlobalCategories(fakeDriveAuth, true, 'proj-1'))

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.hydrated).toBe(true)

    // Initial pull already ran (and found nothing new) — simulate a mapping
    // that landed on Drive from another browser since then.
    mockPullGlobalCategoriesFromDrive.mockClear()
    mockPullGlobalCategoriesFromDrive.mockResolvedValue({
      categories: [{ id: 'c1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }],
      categoryMappings: [
        { id: 'm1', substring: 'WHOLE FOODS', categoryId: 'c1', updatedAt: '2026-03-01T00:00:00.000Z' },
      ],
    })

    await act(async () => {
      await result.current.syncNow()
    })

    expect(result.current.categoryMappings).toHaveLength(1)
    expect(result.current.categoryMappings[0].substring).toBe('WHOLE FOODS')
  })

  it('excludes tombstoned categories and mappings from hook output', async () => {
    const fixture: GlobalCategoryState = {
      categories: [
        { id: 'c1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'c2', name: 'Deleted Cat', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: '2026-01-02T00:00:00.000Z' },
      ],
      categoryMappings: [
        { id: 'm1', substring: 'WHOLE FOODS', categoryId: 'c1', updatedAt: '2026-01-01T00:00:00.000Z' },
        {
          id: 'm2',
          substring: 'OLD STORE',
          categoryId: 'c2',
          updatedAt: '2026-01-01T00:00:00.000Z',
          deletedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    }
    mockLoadGlobalCategoryState.mockResolvedValue(fixture)

    const { result } = renderHook(() => useGlobalCategories(null, false, null))

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    expect(result.current.categories).toHaveLength(1)
    expect(result.current.categories[0].id).toBe('c1')
    expect(result.current.categoryMappings).toHaveLength(1)
    expect(result.current.categoryMappings[0].id).toBe('m1')
  })
})
