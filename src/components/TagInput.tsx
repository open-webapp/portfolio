import { useState } from 'react'

export interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  ariaLabel?: string
  disabled?: boolean
}

const MAX_TAGS = 5
const MAX_TOKEN_LEN = 10

function sanitizeToken(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, MAX_TOKEN_LEN)
}

/**
 * TagInput: free-form tag editor. Chips (`span.tag.tag-outline` with a
 * per-chip remove button) plus a text input. Invalid chars are stripped
 * live, tokens cap at 10 chars, Enter/`,` commits (5-chip cap,
 * case-insensitive dedup, first-casing wins), Backspace on empty input
 * removes the last chip.
 */
export function TagInput({ value, onChange, ariaLabel = 'Tags', disabled = false }: TagInputProps) {
  const [draft, setDraft] = useState('')

  const commit = (token: string) => {
    const cleaned = sanitizeToken(token)
    if (cleaned === '') return
    if (value.length >= MAX_TAGS) return
    if (value.some((t) => t.toLowerCase() === cleaned.toLowerCase())) {
      setDraft('')
      return
    }
    onChange([...value, cleaned])
    setDraft('')
  }

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div>
      {value.map((tag, i) => (
        <span key={`${tag.toLowerCase()}-${i}`} className="tag tag-outline">
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onClick={() => removeAt(i)} disabled={disabled}>
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
            onChange(value.slice(0, -1))
          }
        }}
      />
    </div>
  )
}
