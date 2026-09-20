import { useEffect, useReducer, useRef, useState } from 'react'
import {
  categoryStoreReducer,
  initialGlobalCategoryState,
  visibleBudgetAccountRules,
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
import type { ExpenseDefinition } from '../lib/types'
import type { Portfolio } from '../lib/types'

const SAVE_DEBOUNCE_MS = 500
const POLL_INTERVAL_MS = 60_000

export function useGlobalCategories(
  driveAuth: ReturnType<typeof getDriveAuthFor> | null,
  driveConnected: boolean,
  driveProjectId: string | null,
  budgetExpenseDefinitions: ExpenseDefinition[] | undefined = []
) {
  const [state, dispatch] = useReducer(categoryStoreReducer, initialGlobalCategoryState())
  const [hydrated, setHydrated] = useState(false)

  const skipNextSaveRef = useRef(true)
  const didInitialPullRef = useRef(false)
  const [initialPullDone, setInitialPullDone] = useState(false)
  const latestStateRef = useRef(state)
  latestStateRef.current = state

  // One-shot hydrate on mount. Deferred while budgetExpenseDefinitions is
  // undefined (App passes undefined until its own portfolio state hydrates
  // post-unlock): loadGlobalCategoryState runs the categoryId→spendExpenseId
  // migration, which needs the active portfolio's real definitions — running
  // it with a pre-hydration [] would resolve nothing and drop every legacy
  // mapping. The didHydrateRef guard keeps this one-shot across defs ref
  // changes (e.g. portfolio switches on the shared cross-portfolio store).
  const didHydrateRef = useRef(false)
  useEffect(() => {
    if (didHydrateRef.current) return
    if (budgetExpenseDefinitions === undefined) return
    didHydrateRef.current = true
    let cancelled = false
    ;(async () => {
      const loaded = await loadGlobalCategoryState(budgetExpenseDefinitions)
      if (cancelled) return
      dispatch({ type: '__REPLACE', state: { ...loaded, budgetAccountRules: loaded.budgetAccountRules ?? [] } })
      setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetExpenseDefinitions])

  // Debounced local save, skipping the first post-hydrate run (would just re-save
  // the state we just loaded).
  useEffect(() => {
    if (!hydrated) return
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    const id = setTimeout(() => {
      saveGlobalCategoryState({
        categories: state.categories,
        categoryMappings: state.categoryMappings,
        budgetAccountRules: state.budgetAccountRules,
      })
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.categories, state.categoryMappings, state.budgetAccountRules, hydrated])

  // Immediate fire-and-forget push to Drive when connected. Gated on
  // initialPullDone: pushGlobalCategoriesToDrive does a blind full-file
  // overwrite (no merge — see categoryDrive.ts), so pushing before the
  // initial pull has read+merged the remote file would race the pull and
  // can permanently clobber a mapping another browser added to Drive
  // before this session ever sees it.
  useEffect(() => {
    if (!hydrated || !initialPullDone) return
    if (!driveConnected || !driveAuth || !driveProjectId) return
    pushGlobalCategoriesToDrive(driveAuth, driveProjectId, {
      categories: state.categories,
      categoryMappings: state.categoryMappings,
      budgetAccountRules: state.budgetAccountRules,
    }).catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.categories, state.categoryMappings, state.budgetAccountRules, hydrated, initialPullDone, driveConnected, driveAuth, driveProjectId])

  // Pull remote categories/mappings, merge with local, and persist. Shared by
  // the initial post-connect pull, the 60s poll, and any caller that wants an
  // on-demand refresh (e.g. after a manual portfolio Drive sync).
  const pullAndMerge = async () => {
    if (!driveConnected || !driveAuth || !driveProjectId) return
    const remote = await pullGlobalCategoriesFromDrive(driveAuth, driveProjectId)
    if (remote === null) return
    const current = latestStateRef.current
    const merged = mergeCategoryState(
      {
        categories: current.categories,
        categoryMappings: current.categoryMappings,
        budgetAccountRules: current.budgetAccountRules,
      },
      remote
    )
    dispatch({ type: '__REPLACE', state: merged })
    await saveGlobalCategoryState(merged)
  }

  // Initial pull-once, the first time driveConnected flips true post-hydrate.
  // Only once this resolves does the push effect above get allowed to run.
  useEffect(() => {
    if (!hydrated || !driveConnected || !driveAuth || !driveProjectId) return
    if (didInitialPullRef.current) return
    didInitialPullRef.current = true
    pullAndMerge().finally(() => setInitialPullDone(true))
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
          {
            categories: current.categories,
            categoryMappings: current.categoryMappings,
            budgetAccountRules: current.budgetAccountRules,
          },
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
    // Portfolio is registry metadata (no budget data), so the reload reuses
    // the hook's threaded definitions. Runs post-unlock (App gates on
    // sessionKey + isHydrated), hence definitions are defined here; the
    // ?? [] fallback only satisfies the signature in unreachable cases.
    const seeded = await loadGlobalCategoryState(budgetExpenseDefinitions ?? [])
    dispatch({ type: '__REPLACE', state: seeded })
  }

  return {
    categories: visibleCategories(state),
    categoryMappings: visibleMappings(state),
    budgetAccountRules: visibleBudgetAccountRules(state),
    dispatch,
    hydrated,
    seedGlobalCategoriesIfNeeded,
    syncNow: pullAndMerge,
  }
}
