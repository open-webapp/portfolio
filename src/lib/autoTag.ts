export interface AutoTagCluster {
  indices: number[]
  tag: string | null
}

/**
 * Union candidate tags into an existing tag list.
 *
 * Mirrors the dedupe+cap-5 rule owned by `updateBudgetTransactionsBulk`:
 * case-insensitive dedup (existing casing wins), candidates appended in
 * order given, stop once the merged list reaches 5 total. Never returns an
 * empty array — returns `undefined` when there is nothing to set (so callers
 * never write `tags: []`).
 *
 * Pure; inputs are not mutated.
 */
export function unionTags(existing: string[] | undefined, toAdd: string[]): string[] | undefined {
  const merged = [...(existing ?? [])]
  const seen = new Set(merged.map((tag) => tag.toLowerCase()))
  for (const tag of toAdd) {
    if (merged.length >= 5) break
    if (seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    merged.push(tag)
  }
  if (merged.length === 0) return undefined
  return merged
}

/**
 * Auto-tag a pool of records by LCP-clustering their descriptions, then
 * unioning each cluster's prefix tag into its members' `tags`.
 *
 * Generic over `T extends { description: string; tags?: string[] }` so the
 * same logic serves both `BudgetTransaction[]` (manual trigger) and import
 * batch `rows` (import trigger). Returns a new array (no mutation of input
 * records); `taggedCount` counts records whose `tags` actually gained a tag
 * (dedup/cap skips excluded).
 */
export function applyAutoTags<T extends { description: string; tags?: string[] }>(
  transactions: T[]
): { transactions: T[]; taggedCount: number } {
  const clusters = clusterDescriptions(transactions.map((t) => t.description))
  const next = transactions.slice()
  let taggedCount = 0
  for (const cluster of clusters) {
    if (cluster.tag === null) continue
    for (const idx of cluster.indices) {
      const current = next[idx]
      const merged = unionTags(current.tags, [cluster.tag])
      if (merged === undefined) continue
      if (current.tags !== undefined && merged.length === current.tags.length) continue
      next[idx] = { ...current, tags: merged }
      taggedCount++
    }
  }
  return { transactions: next, taggedCount }
}

/**
 * Cluster descriptions by case-insensitive longest-common-prefix (LCP)
 * horizontal scan over sort-by-lowercased-description order.
 *
 * A cluster only forms when the trimmed LCP meets MIN_TAG_LENGTH —
 * whitespace never counts toward the minimum, guaranteeing every emitted
 * tag is at least MIN_TAG_LENGTH chars with no leading/trailing whitespace.
 *
 * Pure; no IO. `indices` refer to positions in the input array.
 */
/** Minimum trimmed tag length for an auto-tag cluster to form. */
export const MIN_TAG_LENGTH = 4

export function clusterDescriptions(descriptions: string[]): AutoTagCluster[] {
  if (descriptions.length === 0) return []

  const sorted = descriptions.map((desc, idx) => ({ idx, desc })).sort((a, b) => {
    const al = a.desc.toLowerCase()
    const bl = b.desc.toLowerCase()
    if (al < bl) return -1
    if (al > bl) return 1
    return 0
  })

  const clusters: AutoTagCluster[] = []
  let currentIndices: number[] = [sorted[0].idx]
  let clusterPrefix = sorted[0].desc

  const closeCluster = () => {
    if (currentIndices.length >= 2) {
      const tag = clusterPrefix.trim()
      clusters.push({ indices: currentIndices, tag: tag.length >= MIN_TAG_LENGTH ? tag : null })
    } else {
      clusters.push({ indices: currentIndices, tag: null })
    }
  }

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i].desc
    const nextLower = next.toLowerCase()
    let len = clusterPrefix.length
    const prefixLower = clusterPrefix.toLowerCase()
    while (len > 0 && !nextLower.startsWith(prefixLower.slice(0, len))) {
      len--
    }
    const candidate = clusterPrefix.slice(0, len).trim()
    if (candidate.length >= MIN_TAG_LENGTH) {
      currentIndices.push(sorted[i].idx)
      clusterPrefix = candidate
    } else {
      closeCluster()
      currentIndices = [sorted[i].idx]
      clusterPrefix = sorted[i].desc
    }
  }
  closeCluster()

  return clusters
}
