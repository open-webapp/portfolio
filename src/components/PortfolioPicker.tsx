import { useState } from 'react'
import type { Portfolio } from '../lib/types'

export interface PortfolioPickerProps {
  portfolios: Portfolio[]
  onCreate: (name: string) => Promise<void>
  onRename: (id: string, newName: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onOpen: (id: string) => void
}

/**
 * PortfolioPicker: lists existing portfolios (rename inline, delete, open) and
 * a create-new-portfolio form below. Mirrors PasswordGate.tsx's card/field/btn
 * conventions — no new CSS, only existing design-system classes.
 */
export function PortfolioPicker({ portfolios, onCreate, onRename, onDelete, onOpen }: PortfolioPickerProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [createDraft, setCreateDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const startRename = (portfolio: Portfolio) => {
    setRenamingId(portfolio.id)
    setRenameDraft(portfolio.name)
  }

  const commitRename = async (portfolio: Portfolio) => {
    const trimmed = renameDraft.trim()
    setRenamingId(null)
    if (!trimmed || trimmed.toLowerCase() === portfolio.name.trim().toLowerCase()) {
      return
    }
    await onRename(portfolio.id, trimmed)
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameDraft('')
  }

  const handleDelete = async (portfolio: Portfolio) => {
    const confirmed = window.confirm(`Delete portfolio "${portfolio.name}"? This cannot be undone.`)
    if (!confirmed) return
    await onDelete(portfolio.id)
  }

  const handleCreate = async () => {
    const name = createDraft.trim()
    if (!name) return
    setError(null)
    try {
      await onCreate(name)
      setCreateDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create portfolio')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        {portfolios.map((portfolio) => (
          <div key={portfolio.id} className="card blueprint elev-sm">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {renamingId === portfolio.id ? (
                  <input
                    className="input"
                    value={renameDraft}
                    autoFocus
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => void commitRename(portfolio)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void commitRename(portfolio)
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelRename()
                      }
                    }}
                  />
                ) : (
                  <div className="card-title" onClick={() => startRename(portfolio)} style={{ cursor: 'pointer' }}>
                    {portfolio.name}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <button type="button" className="btn btn-primary" onClick={() => onOpen(portfolio.id)}>
                  Open
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void handleDelete(portfolio)}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card blueprint elev-sm">
        <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
          New portfolio
        </div>
        <div className="field">
          <label>Name</label>
          <input
            className="input"
            placeholder="Enter a portfolio name"
            value={createDraft}
            onChange={(e) => {
              setCreateDraft(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleCreate()
              }
            }}
          />
        </div>

        {error && (
          <div className="tag tag-outline" style={{ marginBottom: 'var(--space-2)' }}>
            {error}
          </div>
        )}

        <button type="button" className="btn btn-primary btn-block blueprint" onClick={() => void handleCreate()}>
          Create
        </button>
      </div>
    </div>
  )
}
