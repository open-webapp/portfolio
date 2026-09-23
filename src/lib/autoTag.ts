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
 * over sort-by-lowercased-description order.
 *
 * Two passes: first compute the LCP between each adjacent sorted pair,
 * then cut between pairs that share less than MIN_TAG_LENGTH (trimmed —
 * whitespace never counts toward the minimum) or whose affinity
 * lengthens without prefix-containment (a divergent description sorting
 * adjacent must not dilute the coherent followers' tag). Each run's tag
 * is its overall LCP in the first member's casing.
 *
 * Once a pair establishes a cluster prefix, later members join only if they
 * preserve it verbatim (case-insensitive) — a divergent description splits
 * into a new cluster instead of diluting the coherent pair's tag.
 *
 * Emitted tags are normalized with `sanitizeTagToken` (mirrors
 * `TagInput`'s manual-entry rule: alphanumeric-only, capped at
 * MAX_TAG_LENGTH), so auto-tags are always valid manual-tags.
 *
 * Pure; no IO. `indices` refer to positions in the input array.
 */
/** Minimum trimmed tag length for an auto-tag cluster to form. */
export const MIN_TAG_LENGTH = 4
/** Maximum emitted tag length — mirrors `TagInput`'s manual-entry cap. */
export const MAX_TAG_LENGTH = 10

/**
 * Normalize a raw LCP tag into a valid tag token: strip non-alphanumerics,
 * cap at MAX_TAG_LENGTH. Mirrors `sanitizeToken` in `TagInput.tsx` (kept as
 * a local mirror so `lib` never imports from `components`).
 */
export function sanitizeTagToken(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, MAX_TAG_LENGTH)
}

export function clusterDescriptions(descriptions: string[]): AutoTagCluster[] {
  if (descriptions.length === 0) return []

  const sorted = descriptions.map((desc, idx) => ({ idx, desc })).sort((a, b) => {
    const al = a.desc.toLowerCase()
    const bl = b.desc.toLowerCase()
    if (al < bl) return -1
    if (al > bl) return 1
    return 0
  })
  if (sorted.length === 1) return [{ indices: [sorted[0].idx], tag: null }]

  // Pass 1: case-insensitive LCP between each adjacent sorted pair.
  // `trimmedLen` is the whitespace-trimmed length (whitespace never counts
  // toward MIN_TAG_LENGTH); `fullPrev` marks prefix-containment (the earlier
  // description is entirely a prefix of the later one).
  const trimmedLen: number[] = []
  const fullPrev: boolean[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i].desc
    const b = sorted[i + 1].desc
    const al = a.toLowerCase()
    const bl = b.toLowerCase()
    let len = 0
    while (len < a.length && len < b.length && al[len] === bl[len]) len++
    trimmedLen.push(a.slice(0, len).trim().length)
    fullPrev.push(len === a.length)
  }

  // Pass 2: cut between i and i+1 when the pair shares too little
  // (existing MIN rule) or when affinity lengthens without containment —
  // i.e. the next pair agrees on strictly more than this pair, so this
  // pair's shorter prefix would dilute the coherent followers' tag
  // (the "netflix -> net" bug). Prefix-containment chains
  // ("AMAZON MKT 1" < "AMAZON MKT 12") are exempt: lengthening there is
  // genuine growth, not dilution.
  const cutAfter: boolean[] = trimmedLen.map((t, i) => {
    if (t < MIN_TAG_LENGTH) return true
    if (i < trimmedLen.length - 1 && t < trimmedLen[i + 1] && !fullPrev[i]) return true
    return false
  })

  // Pass 3: runs between cuts become clusters; each run's tag is the
  // sanitized overall LCP (first member's casing), or null for singletons
  // and sub-MIN/sanitize-empty runs.
  const clusters: AutoTagCluster[] = []
  let runStart = 0
  const closeRun = (endExclusive: number) => {
    const members = sorted.slice(runStart, endExclusive)
    if (members.length < 2) {
      clusters.push({ indices: members.map((m) => m.idx), tag: null })
      return
    }
    const first = members[0].desc
    const firstLower = first.toLowerCase()
    let len = first.length
    for (let k = 1; k < members.length; k++) {
      const otherLower = members[k].desc.toLowerCase()
      while (len > 0 && !otherLower.startsWith(firstLower.slice(0, len))) len--
    }
    const raw = first.slice(0, len).trim()
    const tag = sanitizeTagToken(raw)
    clusters.push({
      indices: members.map((m) => m.idx),
      tag: raw.length >= MIN_TAG_LENGTH && tag.length >= MIN_TAG_LENGTH ? tag : null,
    })
  }
  for (let i = 0; i < cutAfter.length; i++) {
    if (cutAfter[i]) {
      closeRun(i + 1)
      runStart = i + 1
    }
  }
  closeRun(sorted.length)

  return clusters
}
