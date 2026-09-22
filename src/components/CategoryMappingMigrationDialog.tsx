import { useState } from 'react'
import type { CategoryMapping } from '../lib/types'

export interface CategoryMappingMigrationDialogProps {
  open: boolean
  mappings: CategoryMapping[]
  onConfirm: (spendExpenseIds: Set<string>) => Promise<void>
  onDismiss: () => void
}

export function CategoryMappingMigrationDialog({
  open,
  mappings,
  onConfirm,
  onDismiss,
}: CategoryMappingMigrationDialogProps) {
  const [busy, setBusy] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)

  if (!open) return null

  const confirm = async () => {
    setBusy(true)
    setInlineError(null)
    try {
      await onConfirm(new Set(mappings.map((mapping) => mapping.spendExpenseId)))
    } catch {
      setInlineError('Could not remove the mappings from the shared store. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" style={{ zIndex: 1000 }}>
      <div className="dialog blueprint" style={{ width: 'min(92vw, 440px)' }}>
        <div className="dialog-title">Remove shared category mappings?</div>
        <div className="dialog-body" style={{ textAlign: 'left' }}>
          <div className="text-muted" style={{ fontSize: '13px', marginBottom: '14px' }}>
            {mappings.length} category mapping{mappings.length === 1 ? ' was' : 's were'} copied into this portfolio and still exist in the shared store. Remove them from there now that they live here?
          </div>
          {inlineError && <div role="alert" style={{ color: '#8a3c2e', fontSize: '12px' }}>{inlineError}</div>}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary blueprint" disabled={busy} onClick={onDismiss}>
            Keep for now
          </button>
          <button type="button" className="btn btn-primary blueprint" disabled={busy} onClick={() => void confirm()}>
            Remove from shared store
          </button>
        </div>
      </div>
    </div>
  )
}
