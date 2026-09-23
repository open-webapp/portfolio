import { describe, expect, it } from 'vitest'
import { applyAutoTags, clusterDescriptions, unionTags } from './autoTag'
import type { BudgetTransaction } from './types'

describe('clusterDescriptions', () => {
  it('clusters two similar descriptions, leaves the odd one out', () => {
    const result = clusterDescriptions(['COSTCO WHSE #123', 'COSTCO WHSE #456', 'STARBUCKS SEATTLE'])
    expect(result).toHaveLength(2)
    const pair = result.find((c) => c.indices.length === 2)!
    expect(new Set(pair.indices)).toEqual(new Set([0, 1]))
    expect(pair.tag).toBe('COSTCOWHSE')
    const solo = result.find((c) => c.indices.length === 1)!
    expect(solo.indices).toEqual([2])
    expect(solo.tag).toBeNull()
  })

  it('clusters on LCP of exactly 4 chars', () => {
    const result = clusterDescriptions(['ABCDEF', 'ABCDXYZ'])
    expect(result).toHaveLength(1)
    expect(result[0].indices).toHaveLength(2)
    expect(result[0].tag).toBe('ABCD')
  })

  it('does not cluster on LCP of only 3 chars', () => {
    const result = clusterDescriptions(['ABCEF', 'ABCXYZ'])
    expect(result).toHaveLength(2)
    for (const c of result) {
      expect(c.indices).toHaveLength(1)
      expect(c.tag).toBeNull()
    }
  })

  it('does not count trailing whitespace toward the min length', () => {
    // Raw LCP is 4 chars ("ABC ") but trimmed is only 3 — must not cluster.
    const result = clusterDescriptions(['ABC 1', 'ABC 2'])
    expect(result).toHaveLength(2)
    for (const c of result) {
      expect(c.indices).toHaveLength(1)
      expect(c.tag).toBeNull()
    }
  })

  it('clusters when trimmed LCP meets min 4', () => {
    const result = clusterDescriptions(['ABCD 1', 'ABCD 2'])
    expect(result).toHaveLength(1)
    expect(result[0].indices).toHaveLength(2)
    expect(result[0].tag).toBe('ABCD')
  })

  it('clusters case-insensitively', () => {
    const result = clusterDescriptions(['Costco Whse', 'COSTCO WHSE #2'])
    expect(result).toHaveLength(1)
    expect(result[0].indices).toHaveLength(2)
    expect(result[0].tag).toBe('CostcoWhse')
  })

  it('gives singleton clusters tag null', () => {
    const result = clusterDescriptions(['COSTCO WHSE #123', 'ZZZ SOLO'])
    const solo = result.find((c) => c.indices.includes(1))!
    expect(solo.indices).toEqual([1])
    expect(solo.tag).toBeNull()
  })

  it('preserves tag casing from the FIRST member by sort order', () => {
    const result = clusterDescriptions(['COSTCO WHSE #123', 'COSTCO WHSE #456'])
    expect(result).toHaveLength(1)
    expect(result[0].tag).toBe('COSTCOWHSE')
    expect(result[0].tag).not.toBe('costcowhse')
  })

  it('sanitizes to alphanumeric capped at 10 chars, no word-boundary snap', () => {
    // Raw LCP is "COSTCO WHSE #" (char LCP, not word-snapped) — emitted
    // sanitized like a manual TagInput token.
    const result = clusterDescriptions(['COSTCO WHSE #123', 'COSTCO WHSE #456'])
    expect(result[0].tag).toBe('COSTCOWHSE')
    expect(result[0].tag).not.toBe('COSTCO WHSE')
  })

  it('keeps prefix-containment chains together (AMAZON MKT 1 < 12 < 123)', () => {
    const result = clusterDescriptions(['AMAZON MKT 1', 'AMAZON MKT 12', 'AMAZON MKT 123'])
    expect(result).toHaveLength(1)
    expect(result[0].indices).toHaveLength(3)
    expect(result[0].tag).toBe('AMAZONMKT1')
  })

  it('keeps numbered series together despite slight pair LCP differences', () => {
    const result = clusterDescriptions(['NETFLIX SUB 1', 'NETFLIX SUB 10', 'NETFLIX SUB 2'])
    expect(result).toHaveLength(1)
    expect(result[0].indices).toHaveLength(3)
    expect(result[0].tag).toBe('NETFLIXSUB')
  })

  it('partitions a multi-cluster pool correctly', () => {
    const descriptions = [
      'COSTCO WHSE #1', // 0
      'STARBUCKS A', // 1
      'AMAZON MKT 1', // 2
      'COSTCO WHSE #2', // 3
      'STARBUCKS B', // 4
      'AMAZON MKT 2', // 5
      'ZZZ SOLO', // 6
    ]
    const result = clusterDescriptions(descriptions)
    expect(result).toHaveLength(4)
    const byIndex = new Map<number, (typeof result)[number]>()
    for (const c of result) for (const i of c.indices) byIndex.set(i, c)
    // Paired members share a cluster with a non-null tag
    expect(byIndex.get(0)).toBe(byIndex.get(3))
    expect(byIndex.get(1)).toBe(byIndex.get(4))
    expect(byIndex.get(2)).toBe(byIndex.get(5))
    expect(byIndex.get(0)!.tag).toBe('COSTCOWHSE')
    expect(byIndex.get(2)!.tag).toBe('AMAZONMKT')
    expect(byIndex.get(1)!.tag).toBe('STARBUCKS')
    // Solo record is alone with null tag
    expect(byIndex.get(6)!.indices).toEqual([6])
    expect(byIndex.get(6)!.tag).toBeNull()
    // Every input index appears exactly once
    const all = result.flatMap((c) => c.indices).sort((a, b) => a - b)
    expect(all).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('returns [] for an empty pool', () => {
    expect(clusterDescriptions([])).toEqual([])
  })

  it('returns one null-tagged cluster for a single record', () => {
    const result = clusterDescriptions(['COSTCOWHSE123'])
    expect(result).toHaveLength(1)
    expect(result[0].indices).toEqual([0])
    expect(result[0].tag).toBeNull()
  })

  it('caps a full-description LCP tag at 10 alphanumeric chars (bug: entire string)', () => {
    const desc = 'JPMORGAN CHASE   CHASE ACH                  PPD ID: 353'
    const result = clusterDescriptions([desc, desc])
    expect(result).toHaveLength(1)
    expect(result[0].tag).not.toBe(desc)
    expect(result[0].tag!.length).toBeLessThanOrEqual(10)
    expect(result[0].tag).toMatch(/^[a-zA-Z0-9]+$/)
  })

  it('does not dilute a coherent pair when a divergent third sorts adjacent (bug: netflix -> net)', () => {
    const result = clusterDescriptions(['NETFLIX SUB 1', 'NETFLIX SUB 2', 'NETF OTHER'])
    const byIndex = new Map<number, (typeof result)[number]>()
    for (const c of result) for (const i of c.indices) byIndex.set(i, c)
    // Coherent pair keeps its own full LCP, divergent third splits off
    expect(byIndex.get(0)).toBe(byIndex.get(1))
    expect(byIndex.get(0)!.tag).toBe('NETFLIXSUB')
    expect(byIndex.get(2)!.indices).toEqual([2])
    expect(byIndex.get(2)!.tag).toBeNull()
  })
})

describe('unionTags', () => {
  it('returns undefined when there is nothing to set', () => {
    expect(unionTags(undefined, [])).toBeUndefined()
    expect(unionTags([], [])).toBeUndefined()
  })

  it('dedups case-insensitively, existing casing wins', () => {
    expect(unionTags(['Groceries'], ['groceries', 'Weekly'])).toEqual(['Groceries', 'Weekly'])
  })

  it('caps at 5 total, in order given', () => {
    expect(unionTags(['a', 'b', 'c', 'd'], ['e', 'f'])).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(unionTags(['a', 'b', 'c', 'd', 'e'], ['f'])).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('applyAutoTags', () => {
  const tx = (id: string, description: string, tags?: string[]): BudgetTransaction => ({
    id,
    date: '2026-01-05',
    description,
    categoryId: 'c1',
    amount: 10,
    ...(tags === undefined ? {} : { tags }),
  })

  it('tags clustered members, leaves singletons untagged, and does not mutate input', () => {
    const input = [
      tx('a', 'COSTCO WHSE #123'),
      tx('b', 'COSTCO WHSE #456'),
      tx('c', 'STARBUCKS SEATTLE'),
    ]
    const { transactions, taggedCount } = applyAutoTags(input)
    expect(taggedCount).toBe(2)
    expect(transactions[0].tags).toEqual(['COSTCOWHSE'])
    expect(transactions[1].tags).toEqual(['COSTCOWHSE'])
    expect(transactions[2].tags).toBeUndefined()
    // Immutable: input records untouched, new array returned
    expect(input[0].tags).toBeUndefined()
    expect(input[1].tags).toBeUndefined()
    expect(transactions).not.toBe(input)
  })

  it('dedups case-insensitively against pre-existing tags and excludes them from taggedCount', () => {
    const input = [tx('a', 'COSTCO WHSE #123', ['costcowhse']), tx('b', 'COSTCO WHSE #456')]
    const { transactions, taggedCount } = applyAutoTags(input)
    expect(taggedCount).toBe(1)
    // Existing casing wins, no duplicate appended
    expect(transactions[0].tags).toEqual(['costcowhse'])
    expect(transactions[1].tags).toEqual(['COSTCOWHSE'])
  })

  it('silently skips records already at the 5-tag cap without counting them', () => {
    const input = [
      tx('a', 'COSTCO WHSE #123', ['t1', 't2', 't3', 't4', 't5']),
      tx('b', 'COSTCO WHSE #456'),
    ]
    const { transactions, taggedCount } = applyAutoTags(input)
    expect(taggedCount).toBe(1)
    expect(transactions[0].tags).toEqual(['t1', 't2', 't3', 't4', 't5'])
    expect(transactions[1].tags).toEqual(['COSTCOWHSE'])
  })

  it('never removes or replaces existing tags', () => {
    const input = [tx('a', 'COSTCO WHSE #123', ['manual']), tx('b', 'COSTCO WHSE #456')]
    const { transactions, taggedCount } = applyAutoTags(input)
    expect(taggedCount).toBe(2)
    expect(transactions[0].tags).toEqual(['manual', 'COSTCOWHSE'])
    expect(transactions[1].tags).toEqual(['COSTCOWHSE'])
  })

  it('unions unrelated existing tags with the new cluster tag', () => {
    const input = [tx('a', 'COSTCO WHSE #123', ['groceries', 'weekly']), tx('b', 'COSTCO WHSE #456')]
    const { transactions, taggedCount } = applyAutoTags(input)
    expect(taggedCount).toBe(2)
    expect(transactions[0].tags).toEqual(['groceries', 'weekly', 'COSTCOWHSE'])
  })

  it('returns an empty pool unchanged with count 0', () => {
    expect(applyAutoTags([])).toEqual({ transactions: [], taggedCount: 0 })
  })
})
