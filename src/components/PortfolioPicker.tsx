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
 * a create-new-portfolio form below. Layout mirrors notesdiary's ProjectPicker
 * (centered column, list section + create section, meta line, text-link
 * delete) but uses this app's own design-system classes (card/btn/input).
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minHeight: '100%',
        padding: 'var(--space-8) var(--space-6) var(--space-6)',
        gap: 'var(--space-8)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 480, minWidth: 0 }}>
        <h2 className="card-title" style={{ fontSize: 24, marginBottom: 'var(--space-4)' }}>
          Your Portfolios
        </h2>

        {portfolios.length === 0 ? (
          <p className="card-body" style={{ fontStyle: 'italic' }}>
            No portfolios yet. Create one below to get started.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
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
                    <p className="card-body" style={{ fontSize: 12, margin: 'var(--space-1) 0 0' }}>
                      Created {new Date(portfolio.createdAt).toLocaleDateString()}
                    </p>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{
                        border: 'none',
                        background: 'none',
                        padding: 0,
                        marginTop: 'var(--space-1)',
                        fontSize: 12,
                        display: 'block',
                        cursor: 'pointer',
                      }}
                      onClick={() => void handleDelete(portfolio)}
                      title={`Delete ${portfolio.name}`}
                    >
                      Delete
                    </button>
                  </div>

                  <div style={{ flexShrink: 0 }}>
                    <button type="button" className="btn btn-primary" onClick={() => onOpen(portfolio.id)}>
                      Open
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ width: '100%', maxWidth: 480, paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-divider)' }}>
        <h2 className="card-title" style={{ fontSize: 18, marginBottom: 'var(--space-4)' }}>
          Create New Portfolio
        </h2>

        <div className="field">
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

        <button type="button" className="btn btn-primary" onClick={() => void handleCreate()}>
          Create
        </button>
      </div>
    </div>
  )
}
