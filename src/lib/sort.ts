/**
 * Generic table sort helper
 * Sorts items by a given key and direction
 * @param items - Array of items to sort
 * @param key - Key to sort by (must be a key of T)
 * @param dir - Sort direction: 'asc' or 'desc'
 * @returns New sorted array (non-mutating)
 */
export function sortBy<T>(
  items: T[],
  key: keyof T,
  dir: 'asc' | 'desc'
): T[] {
  const dir_mult = dir === 'desc' ? -1 : 1

  return [...items].sort((a, b) => {
    const aVal = a[key]
    const bVal = b[key]

    // Handle null/undefined
    if (aVal == null && bVal == null) return 0
    if (aVal == null) return dir === 'desc' ? -1 : 1
    if (bVal == null) return dir === 'desc' ? 1 : -1

    // Numeric comparison
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return (aVal - bVal) * dir_mult
    }

    // String comparison (case-insensitive using localeCompare)
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return aVal.localeCompare(bVal, undefined, { sensitivity: 'base' }) * dir_mult
    }

    // Fallback: use standard comparison
    if (aVal < bVal) return -1 * dir_mult
    if (aVal > bVal) return 1 * dir_mult
    return 0
  })
}
