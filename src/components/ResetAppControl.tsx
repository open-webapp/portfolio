import { useState } from 'react'

export interface ResetAppControlProps {
  onReset: () => Promise<void>
}

/**
 * ResetAppControl: the "Reset App" trigger, its type-RESET-to-confirm dialog,
 * and the post-reset toast. Extracted from PasswordGate's GateShell so it can
 * be reused by both the gate screen and Settings, which each own their own
 * intro copy/placement around this control.
 */
export function ResetAppControl({ onReset }: ResetAppControlProps) {
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [resetting, setResetting] = useState(false)
  const [resetDone, setResetDone] = useState(false)

  const resetConfirmDisabled = resetConfirmText.trim().toUpperCase() !== 'RESET' || resetting

  const handleConfirmReset = async () => {
    setResetting(true)
    try {
      await onReset()
      setResetConfirmOpen(false)
      setResetConfirmText('')
      setResetDone(true)
    } finally {
      setResetting(false)
    }
  }

  return (
    <>
      <span
        onClick={() => {
          setResetConfirmOpen(true)
          setResetConfirmText('')
        }}
        style={{
          fontSize: '11px',
          color: '#8a3c2e',
          opacity: 0.55,
          cursor: 'pointer',
          letterSpacing: '0.03em',
          textDecoration: 'underline',
          textUnderlineOffset: '2px',
        }}
      >
        Reset App
      </span>

      {resetConfirmOpen && (
        <div className="dialog-backdrop" style={{ zIndex: 1000 }}>
          <div className="dialog blueprint" style={{ width: 'min(92vw, 420px)', background: 'var(--color-bg)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="dialog-title" style={{ color: '#8a3c2e' }}>
              Reset app and erase all data?
            </div>
            <div className="dialog-body" style={{ textAlign: 'left' }}>
              <div className="text-muted" style={{ fontSize: '13px', marginBottom: 'var(--space-4)' }}>
                This permanently deletes every encrypted account, position and transaction on this device. This
                cannot be undone.
              </div>
              <div className="field">
                <label>Type RESET to confirm</label>
                <input
                  className="input"
                  placeholder="RESET"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                />
              </div>
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-secondary blueprint"
                onClick={() => {
                  setResetConfirmOpen(false)
                  setResetConfirmText('')
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn blueprint"
                disabled={resetConfirmDisabled}
                onClick={handleConfirmReset}
                style={{ background: '#8a3c2e', borderColor: '#8a3c2e', color: '#fff' }}
              >
                {resetting ? 'Erasing...' : 'Erase Everything'}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetDone && (
        <div
          style={{
            position: 'fixed',
            bottom: 'var(--space-6)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--color-text)',
            color: 'var(--color-bg)',
            padding: '10px 18px',
            fontSize: '13px',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          App reset. All data wiped.
        </div>
      )}
    </>
  )
}
