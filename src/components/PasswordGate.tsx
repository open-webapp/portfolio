import { useState } from 'react'
import type { AppState } from '../lib/state'
import { deriveKey, generateSalt } from '../lib/crypto'
import { loadPersistedApp, peekStoredSalt } from '../lib/persist'

export interface PasswordGateProps {
  shape: 'absent' | 'encrypted'
  onUnlock: (key: CryptoKey, salt: Uint8Array, loadedState?: AppState) => Promise<void> | void
  onBackToPicker: () => void
}

/**
 * PasswordGate: full-replacement gate screen rendered by App.tsx instead of the
 * Nav/Accounts tree until the user has unlocked (or set) a password.
 * Mirrors design/v4's "Encryption Password" screen layout for both shapes.
 */
export function PasswordGate({ shape, onUnlock, onBackToPicker }: PasswordGateProps) {
  return shape === 'encrypted' ? (
    <EnterPasswordScreen onUnlock={onUnlock} onBackToPicker={onBackToPicker} />
  ) : (
    <SetPasswordScreen onUnlock={onUnlock} onBackToPicker={onBackToPicker} />
  )
}

interface GateShellProps {
  title: string
  subtitle: string
  children: React.ReactNode
  onBackToPicker: () => void
  tabControl?: React.ReactNode
  noCardWrapper?: boolean
}

function GateShell({
  title,
  subtitle,
  children,
  onBackToPicker,
  tabControl,
  noCardWrapper = false,
}: GateShellProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-body)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-6)',
      }}
    >
      <div style={{ width: '100%', maxWidth: '440px' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
          <div
            className="text-muted"
            style={{ fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px' }}
          >
            Ledger
          </div>
          <h1 style={{ margin: '0 0 6px' }}>{title}</h1>
          {subtitle && (
            <div className="text-muted" style={{ fontSize: '13px' }}>
              {subtitle}
            </div>
          )}
        </div>

        {tabControl && (
          <div style={{ marginBottom: 'var(--space-5)' }}>
            {tabControl}
          </div>
        )}

        {noCardWrapper ? (
          children
        ) : (
          <div className="card blueprint elev-sm" style={{ marginBottom: 'var(--space-5)' }}>
            {children}
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 'var(--space-5)', textAlign: 'center' }}>
          <div className="text-muted" style={{ fontSize: '12px', lineHeight: 1.6, marginBottom: 'var(--space-3)' }}>
            Forgot your password? You can't recover this portfolio's data without it.
          </div>
          <button
            type="button"
            onClick={onBackToPicker}
            style={{
              fontSize: '11px',
              color: 'var(--color-text)',
              opacity: 0.55,
              cursor: 'pointer',
              letterSpacing: '0.03em',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
              background: 'none',
              border: 'none',
              padding: 0,
            }}
          >
            Back to portfolios
          </button>
        </div>
      </div>
    </div>
  )
}

function SetPasswordScreen({
  onUnlock,
  onBackToPicker,
}: {
  onUnlock: (key: CryptoKey, salt: Uint8Array, loadedState?: AppState) => Promise<void> | void
  onBackToPicker: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    setSubmitting(true)
    try {
      const salt = generateSalt()
      const key = await deriveKey(password, salt)
      await onUnlock(key, salt)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <GateShell
      title="Set Encryption Password"
      subtitle="Choose a password to encrypt your data on this device."
      onBackToPicker={onBackToPicker}
    >
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>New password</label>
          <input
            className="input"
            type="password"
            placeholder="Enter a new password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            autoFocus
          />
        </div>
        <div className="field">
          <label>Confirm password</label>
          <input
            className="input"
            type="password"
            placeholder="Re-enter your password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        <div className="text-muted" style={{ fontSize: '12px', lineHeight: 1.6, marginBottom: 'var(--space-3)' }}>
          This password encrypts your data locally on this device. It is never saved anywhere, and you
          will need to enter it every time you open the app. If you forget it, your data cannot be
          recovered.
        </div>

        {error && (
          <div style={{ color: '#8a3c2e', fontSize: '12px', marginBottom: 'var(--space-2)' }}>{error}</div>
        )}

        <button type="submit" className="btn btn-primary btn-block blueprint" disabled={submitting}>
          {submitting ? 'Setting password...' : 'Set password'}
        </button>
      </form>
    </GateShell>
  )
}

function EnterPasswordScreen({
  onUnlock,
  onBackToPicker,
}: {
  onUnlock: (key: CryptoKey, salt: Uint8Array, loadedState?: AppState) => Promise<void> | void
  onBackToPicker: () => void
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const tryUnlock = async () => {
    if (!password.trim()) {
      setError('Enter your encryption password.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const salt = await peekStoredSalt()
      const key = await deriveKey(password, salt as Uint8Array)
      const loadedState = await loadPersistedApp(key)
      await onUnlock(key, salt as Uint8Array, loadedState ?? undefined)
    } catch {
      setError('Incorrect password')
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void tryUnlock()
  }

  return (
    <GateShell
      title="Encryption Password"
      subtitle="Your data is encrypted on this device. Enter your password to unlock it."
      onBackToPicker={onBackToPicker}
    >
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Password</label>
          <input
            className="input"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
            autoComplete="current-password"
            autoFocus
          />
          {error && (
            <div style={{ color: '#8a3c2e', fontSize: '12px', marginTop: '6px' }}>{error}</div>
          )}
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-block blueprint"
          disabled={submitting}
        >
          {submitting ? 'Unlocking...' : 'Unlock'}
        </button>
      </form>
    </GateShell>
  )
}
