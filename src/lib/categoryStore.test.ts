import { describe, it, expect } from 'vitest'
import {
  initialGlobalCategoryState,
  addCategory,
  renameCategory,
  deleteCategory,
  upsertCategoryMapping,
  updateCategoryMapping,
  addCategoryMapping,
  deleteCategoryMapping,
  resolveCategoryIdForDescription,
  visibleCategories,
  visibleMappings,
  reapplyMappingsToTransactions,
  categoryStoreReducer,
  type GlobalCategoryState,
} from './categoryStore'
import type { Category, CategoryMapping, BudgetTransaction } from './types'

describe('categoryStore', () => {
  describe('addCategory', () => {
    it('appends a new category with the given id and name', () => {
      const s = initialGlobalCategoryState()
      const updated = addCategory(s, 'cat-1', 'Groceries')
      expect(updated.categories).toHaveLength(1)
      expect(updated.categories[0]).toMatchObject({ id: 'cat-1', name: 'Groceries' })
      expect(updated.categories[0].updatedAt).toBeTruthy()
    })
  })

  describe('renameCategory', () => {
    it('patches the name and stamps updatedAt', () => {
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }] }
      const updated = renameCategory(s, 'cat-1', 'Food & Dining')
      expect(updated.categories[0].name).toBe('Food & Dining')
      expect(updated.categories[0].updatedAt).not.toBe('2026-01-01T00:00:00.000Z')
    })

    it('is a no-op when the id is unknown', () => {
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }] }
      const updated = renameCategory(s, 'cat-nope', 'Food & Dining')
      expect(updated.categories).toEqual(s.categories)
    })
  })

  describe('deleteCategory', () => {
    it('stamps both deletedAt and updatedAt', () => {
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }] }
      const updated = deleteCategory(s, 'cat-1')
      expect(updated.categories[0].deletedAt).toBeTruthy()
      expect(updated.categories[0].updatedAt).toBe(updated.categories[0].deletedAt)
    })

    it('is a no-op if the id is unknown', () => {
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }] }
      const updated = deleteCategory(s, 'cat-nope')
      expect(updated).toEqual(s)
    })
  })

  describe('upsertCategoryMapping', () => {
    it('creates a new mapping for a new description', () => {
      const s = initialGlobalCategoryState()
      const updated = upsertCategoryMapping(s, 'Costco', 'cat-1')
      expect(updated.categoryMappings).toHaveLength(1)
      expect(updated.categoryMappings[0]).toMatchObject({ substring: 'Costco', categoryId: 'cat-1' })
    })

    it('matches an existing mapping case-insensitively and updates it instead of duplicating', () => {
      const s = initialGlobalCategoryState()
      const first = upsertCategoryMapping(s, 'Costco', 'cat-1')
      const firstMapping = first.categoryMappings[0]
      const second = upsertCategoryMapping(first, 'COSTCO', 'cat-2')
      expect(second.categoryMappings).toHaveLength(1)
      expect(second.categoryMappings[0].id).toBe(firstMapping.id)
      expect(second.categoryMappings[0].categoryId).toBe('cat-2')
    })

    it('is a no-op for a blank/whitespace-only description', () => {
      const s = initialGlobalCategoryState()
      const updated = upsertCategoryMapping(s, '   ', 'cat-1')
      expect(updated).toEqual(s)
    })

    it('does not let a tombstoned mapping with the same substring block a fresh create', () => {
      const tombstoned: CategoryMapping = {
        id: 'map-old',
        substring: 'Costco',
        categoryId: 'cat-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: '2026-01-02T00:00:00.000Z',
      }
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categoryMappings: [tombstoned] }
      const updated = upsertCategoryMapping(s, 'Costco', 'cat-2')
      expect(updated.categoryMappings).toHaveLength(2)
      const fresh = updated.categoryMappings.find((m) => m.id !== 'map-old')
      expect(fresh).toMatchObject({ substring: 'Costco', categoryId: 'cat-2' })
      expect(fresh?.deletedAt).toBeUndefined()
    })
  })

  describe('updateCategoryMapping', () => {
    it('patches an existing mapping by id', () => {
      const mapping: CategoryMapping = { id: 'map-1', substring: 'Costco', categoryId: 'cat-1', updatedAt: '2026-01-01T00:00:00.000Z' }
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categoryMappings: [mapping] }
      const updated = updateCategoryMapping(s, 'map-1', { categoryId: 'cat-2' })
      expect(updated.categoryMappings[0].categoryId).toBe('cat-2')
      expect(updated.categoryMappings[0].substring).toBe('Costco')
      expect(updated.categoryMappings[0].updatedAt).not.toBe(mapping.updatedAt)
    })

    it('is a no-op when the id is unknown', () => {
      const mapping: CategoryMapping = { id: 'map-1', substring: 'Costco', categoryId: 'cat-1', updatedAt: '2026-01-01T00:00:00.000Z' }
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categoryMappings: [mapping] }
      const updated = updateCategoryMapping(s, 'map-nope', { categoryId: 'cat-2' })
      expect(updated.categoryMappings).toEqual([mapping])
    })
  })

  describe('addCategoryMapping', () => {
    it('appends a new mapping', () => {
      const s = initialGlobalCategoryState()
      const updated = addCategoryMapping(s, 'cat-1', 'Costco')
      expect(updated.categoryMappings).toHaveLength(1)
      expect(updated.categoryMappings[0]).toMatchObject({ substring: 'Costco', categoryId: 'cat-1' })
    })

    it('is a no-op for a blank/whitespace-only substring', () => {
      const s = initialGlobalCategoryState()
      const updated = addCategoryMapping(s, 'cat-1', '   ')
      expect(updated).toEqual(s)
    })
  })

  describe('deleteCategoryMapping', () => {
    it('stamps both deletedAt and updatedAt', () => {
      const mapping: CategoryMapping = { id: 'map-1', substring: 'Costco', categoryId: 'cat-1', updatedAt: '2026-01-01T00:00:00.000Z' }
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categoryMappings: [mapping] }
      const updated = deleteCategoryMapping(s, 'map-1')
      expect(updated.categoryMappings[0].deletedAt).toBeTruthy()
      expect(updated.categoryMappings[0].updatedAt).toBe(updated.categoryMappings[0].deletedAt)
    })

    it('is a no-op when the id is unknown', () => {
      const mapping: CategoryMapping = { id: 'map-1', substring: 'Costco', categoryId: 'cat-1', updatedAt: '2026-01-01T00:00:00.000Z' }
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categoryMappings: [mapping] }
      const updated = deleteCategoryMapping(s, 'map-nope')
      expect(updated).toEqual(s)
    })
  })

  describe('resolveCategoryIdForDescription', () => {
    it('returns the categoryId for a single match', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', categoryId: 'cat-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      expect(resolveCategoryIdForDescription(mappings, 'COSTCO WHSE #123')).toBe('cat-1')
    })

    it('matches case-insensitively', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Grocery', categoryId: 'cat-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      expect(resolveCategoryIdForDescription(mappings, 'grocery store')).toBe('cat-1')
    })

    it('returns null when there is no match', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', categoryId: 'cat-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      expect(resolveCategoryIdForDescription(mappings, 'Netflix')).toBeNull()
    })

    it('returns the categoryId of the latest-updatedAt match among multiple matches, regardless of substring length', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Whole Foods Market', categoryId: 'cat-longer-older', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'map-2', substring: 'Whole Foods', categoryId: 'cat-shorter-newer', updatedAt: '2026-06-01T00:00:00.000Z' },
      ]
      expect(resolveCategoryIdForDescription(mappings, 'Whole Foods Market #42')).toBe('cat-shorter-newer')
    })

    it('ignores a tombstoned mapping even if it would otherwise win on updatedAt', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', categoryId: 'cat-older', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'map-2', substring: 'Costco', categoryId: 'cat-tombstoned-newer', updatedAt: '2026-06-01T00:00:00.000Z', deletedAt: '2026-06-02T00:00:00.000Z' },
      ]
      expect(resolveCategoryIdForDescription(mappings, 'Costco Gas')).toBe('cat-older')
    })
  })

  describe('visibleCategories / visibleMappings', () => {
    it('filters out tombstoned records and preserves order', () => {
      const categories: Category[] = [
        { id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'cat-2', name: 'Deleted', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: '2026-01-02T00:00:00.000Z' },
        { id: 'cat-3', name: 'Dining', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', categoryId: 'cat-1', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'map-2', substring: 'Deleted', categoryId: 'cat-1', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: '2026-01-02T00:00:00.000Z' },
      ]
      const s: GlobalCategoryState = { categories, categoryMappings: mappings }
      expect(visibleCategories(s)).toEqual([categories[0], categories[2]])
      expect(visibleMappings(s)).toEqual([mappings[0]])
    })
  })

  describe('reapplyMappingsToTransactions', () => {
    it('rewrites categoryId for matching transactions and leaves non-matching ones untouched', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', categoryId: 'cat-groceries', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      const txMatching: BudgetTransaction = { id: 'tx-1', date: '2026-01-01', description: 'Costco Gas', categoryId: 'cat-old', amount: 40 }
      const txNonMatching: BudgetTransaction = { id: 'tx-2', date: '2026-01-02', description: 'Netflix', categoryId: 'cat-subs', amount: 15 }

      const updated = reapplyMappingsToTransactions([txMatching, txNonMatching], mappings)

      expect(updated.find((t) => t.id === 'tx-1')?.categoryId).toBe('cat-groceries')
      expect(updated.find((t) => t.id === 'tx-2')).toEqual(txNonMatching)
    })

    it('is idempotent when run twice', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', categoryId: 'cat-groceries', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      const tx: BudgetTransaction = { id: 'tx-1', date: '2026-01-01', description: 'Costco Gas', categoryId: 'cat-old', amount: 40 }

      const once = reapplyMappingsToTransactions([tx], mappings)
      const twice = reapplyMappingsToTransactions(once, mappings)

      expect(twice).toEqual(once)
    })
  })

  describe('categoryStoreReducer', () => {
    it('ADD_CATEGORY appends a category', () => {
      const updated = categoryStoreReducer(initialGlobalCategoryState(), { type: 'ADD_CATEGORY', id: 'cat-1', name: 'Groceries' })
      expect(updated.categories).toHaveLength(1)
      expect(updated.categories[0]).toMatchObject({ id: 'cat-1', name: 'Groceries' })
    })

    it('RENAME_CATEGORY renames a category', () => {
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }] }
      const updated = categoryStoreReducer(s, { type: 'RENAME_CATEGORY', id: 'cat-1', name: 'Food' })
      expect(updated.categories[0].name).toBe('Food')
    })

    it('DELETE_CATEGORY tombstones a category', () => {
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }] }
      const updated = categoryStoreReducer(s, { type: 'DELETE_CATEGORY', id: 'cat-1' })
      expect(updated.categories[0].deletedAt).toBeTruthy()
    })

    it('UPSERT_CATEGORY_MAPPING creates a mapping', () => {
      const updated = categoryStoreReducer(initialGlobalCategoryState(), { type: 'UPSERT_CATEGORY_MAPPING', description: 'Costco', categoryId: 'cat-1' })
      expect(updated.categoryMappings).toHaveLength(1)
    })

    it('UPDATE_CATEGORY_MAPPING patches a mapping', () => {
      const mapping: CategoryMapping = { id: 'map-1', substring: 'Costco', categoryId: 'cat-1', updatedAt: '2026-01-01T00:00:00.000Z' }
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categoryMappings: [mapping] }
      const updated = categoryStoreReducer(s, { type: 'UPDATE_CATEGORY_MAPPING', id: 'map-1', patch: { categoryId: 'cat-2' } })
      expect(updated.categoryMappings[0].categoryId).toBe('cat-2')
    })

    it('ADD_CATEGORY_MAPPING appends a mapping', () => {
      const updated = categoryStoreReducer(initialGlobalCategoryState(), { type: 'ADD_CATEGORY_MAPPING', categoryId: 'cat-1', substring: 'Costco' })
      expect(updated.categoryMappings).toHaveLength(1)
    })

    it('DELETE_CATEGORY_MAPPING tombstones a mapping', () => {
      const mapping: CategoryMapping = { id: 'map-1', substring: 'Costco', categoryId: 'cat-1', updatedAt: '2026-01-01T00:00:00.000Z' }
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categoryMappings: [mapping] }
      const updated = categoryStoreReducer(s, { type: 'DELETE_CATEGORY_MAPPING', id: 'map-1' })
      expect(updated.categoryMappings[0].deletedAt).toBeTruthy()
    })

    it('__MERGE_IMPORTED merges the imported state in via mergeCategoryState (newer updatedAt wins per id, unique ids pass through)', () => {
      const s: GlobalCategoryState = {
        categories: [
          { id: 'c1', name: 'A-Groceries', updatedAt: '2024-01-05T00:00:00.000Z' },
          { id: 'c3', name: 'A-only-cat', updatedAt: '2024-01-01T00:00:00.000Z' },
        ],
        categoryMappings: [
          { id: 'm1', substring: 'walmart', categoryId: 'c1', updatedAt: '2024-01-01T00:00:00.000Z' },
        ],
      }
      const imported: GlobalCategoryState = {
        categories: [
          { id: 'c1', name: 'B-Groceries', updatedAt: '2024-01-02T00:00:00.000Z' },
          { id: 'c4', name: 'B-only-cat', updatedAt: '2024-01-01T00:00:00.000Z' },
        ],
        categoryMappings: [
          { id: 'm1', substring: 'walmart-b', categoryId: 'c1', updatedAt: '2024-01-09T00:00:00.000Z' },
          { id: 'm2', substring: 'costco', categoryId: 'c4', updatedAt: '2024-01-01T00:00:00.000Z' },
        ],
      }
      const updated = categoryStoreReducer(s, { type: '__MERGE_IMPORTED', imported })

      expect(updated.categories).toEqual(
        expect.arrayContaining([
          { id: 'c1', name: 'A-Groceries', updatedAt: '2024-01-05T00:00:00.000Z' },
          { id: 'c3', name: 'A-only-cat', updatedAt: '2024-01-01T00:00:00.000Z' },
          { id: 'c4', name: 'B-only-cat', updatedAt: '2024-01-01T00:00:00.000Z' },
        ])
      )
      expect(updated.categories).toHaveLength(3)
      expect(updated.categoryMappings).toEqual(
        expect.arrayContaining([
          { id: 'm1', substring: 'walmart-b', categoryId: 'c1', updatedAt: '2024-01-09T00:00:00.000Z' },
          { id: 'm2', substring: 'costco', categoryId: 'c4', updatedAt: '2024-01-01T00:00:00.000Z' },
        ])
      )
      expect(updated.categoryMappings).toHaveLength(2)
    })
  })
})
