import { useState } from 'react'

export interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  /**
   * Called synchronously with the next array on chip removal (× click or
   * Backspace on empty input), alongside `onChange`. Lets hosts persist
   * removals immediately instead of waiting for blur — removing a chip
   * unmounts the focused button, so a blur-commit may never fire.
   */
  onRemove?: (tags: string[]) => void
  ariaLabel?: string
  disabled?: boolean
  /**
   * Tags owned elsewhere (e.g. system auto-tags) that count against the
   * combined 5-tag cap and refuse case-insensitive dupes. Never rendered
   * here — the host renders them as read-only chips alongside this input.
   */
  blockedTags?: string[]
}

const MAX_TAGS = 5
const MAX_TOKEN_LEN = 10

function sanitizeToken(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, MAX_TOKEN_LEN)
}

/**
 * TagInput: free-form tag editor. Chips (`span.tag.tag-outline` with a
 * per-chip remove button) plus a text input. Invalid chars are stripped
 * live, tokens cap at 10 chars, Enter/`,` commits (combined 5-chip cap
 * over `value` + `blockedTags`, case-insensitive dedup, first-casing
 * wins), Backspace on empty input removes the last chip.
 */
export function TagInput({ value, onChange, onRemove, ariaLabel = 'Tags', disabled = false, blockedTags = [] }: TagInputProps) {
  const [draft, setDraft] = useState('')

  const commit = (token: string) => {
    const cleaned = sanitizeToken(token)
    if (cleaned === '') return
    const lowered = cleaned.toLowerCase()
    if (value.some((t) => t.toLowerCase() === lowered) || blockedTags.some((t) => t.toLowerCase() === lowered)) {
      setDraft('')
      return
    }
    const mergedUnique = new Set([...value, ...blockedTags].map((t) => t.toLowerCase()))
    if (mergedUnique.size >= MAX_TAGS) return
    onChange([...value, cleaned])
    setDraft('')
  }

  const removeAt = (index: number) => {
    const next = value.filter((_, i) => i !== index)
    onChange(next)
    onRemove?.(next)
  }

  return (
    <div className="tag-input">
      {value.map((tag, i) => (
        <span key={`${tag.toLowerCase()}-${i}`} className="tag tag-outline">
          {tag}
          <button type="button" className="tag-remove" aria-label={`Remove ${tag}`} onClick={() => removeAt(i)} disabled={disabled}>
            ×
          </button>
        </span>
      ))}
      <input
        className="input"
        aria-label={ariaLabel}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(sanitizeToken(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit(draft)
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            e.preventDefault()
            removeAt(value.length - 1)
          }
        }}
      />
    </div>
  )
}
