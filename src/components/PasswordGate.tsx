import { useState } from 'react'
import type { AppState } from '../lib/state'
import { deriveKey, generateSalt } from '../lib/crypto'
import { loadLegacyPlaintextApp, loadPersistedApp, peekStoredSalt, clearPersistedApp } from '../lib/persist'

export interface PasswordGateProps {
  shape: 'absent' | 'legacy-plaintext' | 'encrypted'
  onUnlock: (key: CryptoKey, salt: Uint8Array, migratedState?: AppState) => void
  onReset: () => void
}

const RESET_CONFIRM_MESSAGE =
  'This will permanently delete all locally stored data on this device. Your Google Drive backup (if any) is not affected but will require its own password to restore. Continue?'

/**
 * PasswordGate: full-replacement gate screen rendered by App.tsx instead of the
 * Nav/dashboard tree until the user has unlocked (or set) a password.
 */
export function PasswordGate({ shape, onUnlock, onReset }: PasswordGateProps) {
  const handleReset = async () => {
    if (!window.confirm(RESET_CONFIRM_MESSAGE)) return
    await clearPersistedApp()
    onReset()
  }

  return shape === 'encrypted' ? (
    <EnterPasswordScreen onUnlock={onUnlock} onReset={handleReset} />
  ) : (
    <SetPasswordScreen shape={shape} onUnlock={onUnlock} onReset={handleReset} />
  )
}

function SetPasswordScreen({
  shape,
  onUnlock,
  onReset,
}: {
  shape: 'absent' | 'legacy-plaintext'
  onUnlock: (key: CryptoKey, salt: Uint8Array, migratedState?: AppState) => void
  onReset: () => void
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

      if (shape === 'legacy-plaintext') {
        const migratedState = await loadLegacyPlaintextApp()
        onUnlock(key, salt, migratedState ?? undefined)
      } else {
        onUnlock(key, salt, undefined)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog blueprint">
        <i className="corner tl"></i>
        <i className="corner tr"></i>
        <i className="corner bl"></i>
        <i className="corner br"></i>

        <div className="dialog-title">Set a password</div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>New password</label>
            <input
              className="input"
              type="password"
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
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <p className="text-muted">
            This password encrypts your data locally on this device. It is never saved anywhere, and you
            will need to enter it every time you open the app. If you forget it, your data cannot be
            recovered.
          </p>

          {error && <p style={{ color: '#8a3c2e' }}>{error}</p>}

          <div className="dialog-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Setting password...' : 'Set password'}
            </button>
          </div>
        </form>

        <button type="button" className="btn btn-secondary" onClick={onReset}>
          Reset app
        </button>
      </div>
    </div>
  )
}

function EnterPasswordScreen({
  onUnlock,
  onReset,
}: {
  onUnlock: (key: CryptoKey, salt: Uint8Array, migratedState?: AppState) => void
  onReset: () => void
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const salt = await peekStoredSalt()
      const key = await deriveKey(password, salt as Uint8Array)
      const loadedState = await loadPersistedApp(key)
      onUnlock(key, salt as Uint8Array, loadedState ?? undefined)
    } catch {
      setError('Incorrect password')
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog blueprint">
        <i className="corner tl"></i>
        <i className="corner tr"></i>
        <i className="corner bl"></i>
        <i className="corner br"></i>

        <div className="dialog-title">Enter password</div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </div>

          {error && <p style={{ color: '#8a3c2e' }}>{error}</p>}

          <div className="dialog-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Unlocking...' : 'Unlock'}
            </button>
          </div>
        </form>

        <button type="button" className="btn btn-secondary" onClick={onReset}>
          Reset app
        </button>
      </div>
    </div>
  )
}
