import { useState } from 'react'
import type { TaxCategory } from '../../lib/types'

export interface CategorySelection {
  primary: TaxCategory
  tags?: string[]
}

export interface CategoryMultiSelectProps {
  value: CategorySelection
  onChange: (value: CategorySelection) => void
  existingCustomTags: readonly string[]
}

const BASES: { primary: TaxCategory; label: string }[] = [
  { primary: 'taxable', label: 'Taxable' },
  { primary: 'nonTaxable', label: 'Non-Taxable' },
  { primary: 'taxDeferred', label: 'Tax-Deferred' },
]

const key = (label: string) => label.trim().toLowerCase()
const baseFor = (label: string) => BASES.find((base) => key(base.label) === key(label))

function unique(labels: readonly string[]) {
  const seen = new Set<string>()
  return labels.map((label) => label.trim()).filter((label) => {
    if (!label || seen.has(key(label))) return false
    seen.add(key(label))
    return true
  })
}

/** Controlled selection: primary first, remaining tags in choice order. */
export function CategoryMultiSelect({ value, onChange, existingCustomTags }: CategoryMultiSelectProps) {
  const [draft, setDraft] = useState('')
  const selected = unique([
    BASES.find((base) => base.primary === value.primary)!.label,
    ...(value.tags ?? []),
  ])
  const customTags = unique([...existingCustomTags, ...(value.tags ?? [])]).filter((label) => !baseFor(label))
  const categories = [...BASES.map((base) => base.label), ...customTags]
  const full = selected.length >= 4
  const isSelected = (label: string) => selected.some((item) => key(item) === key(label))

  const emit = (labels: string[]) => {
    const primaryLabel = labels.find((label) => baseFor(label))
    if (!primaryLabel) return
    const tags = labels.filter((label) => key(label) !== key(primaryLabel))
    onChange({ primary: baseFor(primaryLabel)!.primary, ...(tags.length ? { tags } : {}) })
  }

  const toggle = (label: string) => {
    if (isSelected(label)) {
      emit(selected.filter((item) => key(item) !== key(label)))
    } else if (!full) {
      emit([...selected, label])
    }
  }

  const cleaned = draft.trim()
  const duplicate = categories.some((label) => key(label) === key(cleaned))
  const canAdd = !!cleaned && !duplicate && !full && customTags.length < 3
  const add = () => {
    if (!canAdd) return
    emit([...selected, cleaned])
    setDraft('')
  }

  return (
    <div className="field">
      <div className="tag-input">
        {selected.map((label) => <span key={key(label)} className="tag tag-outline">{label}</span>)}
      </div>
      <details>
        <summary className="btn">Categories</summary>
        <div className="card card-compact">
          {categories.map((label) => (
            <label key={key(label)} className="field">
              <input type="checkbox" checked={isSelected(label)} onChange={() => toggle(label)} />
              {label}
            </label>
          ))}
          <input
            className="input"
            aria-label="Add category"
            placeholder={full ? 'Category limit reached' : 'Add a category, press Enter'}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                add()
              }
            }}
          />
          {cleaned && <button type="button" className="btn" disabled={!canAdd} onClick={add}>Add "{cleaned}"</button>}
        </div>
      </details>
      <span className="muted">{selected.length} of 4 selected · {categories.length} of 6 categories</span>
    </div>
  )
}
