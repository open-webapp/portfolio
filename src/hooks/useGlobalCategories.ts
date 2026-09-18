import { useEffect, useReducer, useRef, useState } from 'react'
import {
  categoryStoreReducer,
  initialGlobalCategoryState,
  visibleCategories,
  visibleMappings,
} from '../lib/categoryStore'
import {
  loadGlobalCategoryState,
  saveGlobalCategoryState,
  getLastKnownRemoteModifiedTime,
  setLastKnownRemoteModifiedTime,
} from '../lib/categoryPersist'
import {
  pullGlobalCategoriesFromDrive,
  pushGlobalCategoriesToDrive,
  getGlobalCategoriesModifiedTime,
} from '../lib/categoryDrive'
import { mergeCategoryState } from '../lib/categoryMerge'
import { seedGlobalCategoriesIfNeeded as seedGlobalCategoriesIfNeededImpl } from '../lib/categoryMigration'
import type { getDriveAuthFor } from '../lib/drive'
import type { Portfolio } from '../lib/types'

const SAVE_DEBOUNCE_MS = 500
const POLL_INTERVAL_MS = 60_000

export function useGlobalCategories(
  driveAuth: ReturnType<typeof getDriveAuthFor> | null,
  driveConnected: boolean,
  driveProjectId: string | null
) {
  const [state, dispatch] = useReducer(categoryStoreReducer, initialGlobalCategoryState())
  const [hydrated, setHydrated] = useState(false)

  const skipNextSaveRef = useRef(true)
  const didInitialPullRef = useRef(false)
  const latestStateRef = useRef(state)
  latestStateRef.current = state

  // One-shot hydrate on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loaded = await loadGlobalCategoryState()
      if (cancelled) return
      dispatch({ type: '__REPLACE', state: loaded })
      setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced local save, skipping the first post-hydrate run (would just re-save
  // the state we just loaded).
  useEffect(() => {
    if (!hydrated) return
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    const id = setTimeout(() => {
      saveGlobalCategoryState({ categories: state.categories, categoryMappings: state.categoryMappings })
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.categories, state.categoryMappings, hydrated])

  // Immediate fire-and-forget push to Drive when connected.
  useEffect(() => {
    if (!hydrated) return
    if (!driveConnected || !driveAuth || !driveProjectId) return
    pushGlobalCategoriesToDrive(driveAuth, driveProjectId, {
      categories: state.categories,
      categoryMappings: state.categoryMappings,
    }).catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.categories, state.categoryMappings, hydrated, driveConnected, driveAuth, driveProjectId])

  // Pull remote categories/mappings, merge with local, and persist. Shared by
  // the initial post-connect pull, the 60s poll, and any caller that wants an
  // on-demand refresh (e.g. after a manual portfolio Drive sync).
  const pullAndMerge = async () => {
    if (!driveConnected || !driveAuth || !driveProjectId) return
    const remote = await pullGlobalCategoriesFromDrive(driveAuth, driveProjectId)
    if (remote === null) return
    const current = latestStateRef.current
    const merged = mergeCategoryState(
      { categories: current.categories, categoryMappings: current.categoryMappings },
      remote
    )
    dispatch({ type: '__REPLACE', state: merged })
    await saveGlobalCategoryState(merged)
  }

  // Initial pull-once, the first time driveConnected flips true post-hydrate.
  useEffect(() => {
    if (!hydrated || !driveConnected || !driveAuth || !driveProjectId) return
    if (didInitialPullRef.current) return
    didInitialPullRef.current = true
    pullAndMerge()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveConnected, hydrated])

  // 60s poll for remote changes.
  useEffect(() => {
    if (!hydrated) return
    const id = setInterval(() => {
      if (!driveConnected || !driveAuth || !driveProjectId) return
      ;(async () => {
        const modifiedTime = await getGlobalCategoriesModifiedTime(driveAuth, driveProjectId)
        if (modifiedTime === null) return
        const bookmark = await getLastKnownRemoteModifiedTime()
        if (bookmark && modifiedTime <= bookmark) return
        const remote = await pullGlobalCategoriesFromDrive(driveAuth, driveProjectId)
        if (remote === null) return
        const current = latestStateRef.current
        const merged = mergeCategoryState(
          { categories: current.categories, categoryMappings: current.categoryMappings },
          remote
        )
        dispatch({ type: '__REPLACE', state: merged })
        await saveGlobalCategoryState(merged)
        await setLastKnownRemoteModifiedTime(modifiedTime)
      })()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  const seedGlobalCategoriesIfNeeded = async (portfolio: Portfolio, rawBlob: Record<string, unknown>) => {
    await seedGlobalCategoriesIfNeededImpl(portfolio, rawBlob)
    const seeded = await loadGlobalCategoryState()
    dispatch({ type: '__REPLACE', state: seeded })
  }

  return {
    categories: visibleCategories(state),
    categoryMappings: visibleMappings(state),
    dispatch,
    hydrated,
    seedGlobalCategoriesIfNeeded,
    syncNow: pullAndMerge,
  }
}
