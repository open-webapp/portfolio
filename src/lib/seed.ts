/**
 * Generate a unique ID with the given prefix.
 * Format: "prefix-abc123def"
 */
export function uid(prefix: string): string {
  return prefix + '-' + Math.random().toString(36).slice(2, 9)
}
