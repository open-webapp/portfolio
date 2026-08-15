import { useState, useEffect } from 'react'
import type { AppState } from '../lib/state'
import { deriveKey, generateSalt } from '../lib/crypto'
import { loadLegacyPlaintextApp, loadPersistedApp, peekStoredSalt, clearPersistedApp } from '../lib/persist'
import { DriveRestorePanel } from './DriveRestorePanel'

export interface PasswordGateProps {
  shape: 'absent' | 'legacy-plaintext' | 'encrypted'
  onUnlock: (key: CryptoKey, salt: Uint8Array, migratedState?: AppState) => void
  onReset: () => void
  // Drive props for restore feature
  driveReady?: boolean
  driveEmail?: string | null
  backupFileId?: string | null
  syncing?: boolean
  setSyncing?: (v: boolean) => void
  handleConnect?: () => void
  handleDisconnect?: () => void
}

/**
 * PasswordGate: full-replacement gate screen rendered by App.tsx instead of the
 * Nav/Accounts tree until the user has unlocked (or set) a password.
 * Mirrors design/v4's "Encryption Password" screen layout for all three shapes.
 */
export function PasswordGate({
  shape,
  onUnlock,
  onReset,
  driveReady = false,
  driveEmail = null,
  backupFileId = null,
  syncing = false,
  setSyncing,
  handleConnect,
  handleDisconnect,
}: PasswordGateProps) {
  const handleReset = async () => {
    await clearPersistedApp()
    onReset()
  }

  return shape === 'encrypted' ? (
    <EnterPasswordScreen onUnlock={onUnlock} onReset={handleReset} />
  ) : (
    <SetPasswordScreen
      shape={shape}
      onUnlock={onUnlock}
      onReset={handleReset}
      driveReady={driveReady}
      driveEmail={driveEmail}
      backupFileId={backupFileId}
      syncing={syncing}
      setSyncing={setSyncing}
      handleConnect={handleConnect}
      handleDisconnect={handleDisconnect}
    />
  )
}

interface GateShellProps {
  title: string
  subtitle: string
  children: React.ReactNode
  onReset: () => Promise<void>
  tabControl?: React.ReactNode
}

function GateShell({
  title,
  subtitle,
  children,
  onReset,
  tabControl,
}: GateShellProps) {
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
          <div className="text-muted" style={{ fontSize: '13px' }}>
            {subtitle}
          </div>
        </div>

        {tabControl && (
          <div style={{ marginBottom: 'var(--space-5)' }}>
            {tabControl}
          </div>
        )}

        <div className="card blueprint elev-sm" style={{ marginBottom: 'var(--space-5)' }}>
          {children}
        </div>

        <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 'var(--space-5)', textAlign: 'center' }}>
          <div className="text-muted" style={{ fontSize: '12px', lineHeight: 1.6, marginBottom: 'var(--space-3)' }}>
            If you do not have the encryption password, you cannot access any of the content that's encrypted. You
            can "Reset" the app, which will wipe out all existing data so you can start over.
          </div>
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
        </div>
      </div>

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
    </div>
  )
}

function SetPasswordScreen({
  shape,
  onUnlock,
  onReset,
  driveReady = false,
  driveEmail = null,
  backupFileId = null,
  syncing = false,
  setSyncing,
  handleConnect,
  handleDisconnect,
}: {
  shape: 'absent' | 'legacy-plaintext'
  onUnlock: (key: CryptoKey, salt: Uint8Array, migratedState?: AppState) => void
  onReset: () => Promise<void>
  driveReady?: boolean
  driveEmail?: string | null
  backupFileId?: string | null
  syncing?: boolean
  setSyncing?: (v: boolean) => void
  handleConnect?: () => void
  handleDisconnect?: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Tab control for new vs restore (only in 'absent' shape)
  const [gateTab, setGateTab] = useState<'new' | 'restore'>('new')

  // Dummy key/salt for restore panel initialization
  const [dummyKey, setDummyKey] = useState<CryptoKey | null>(null)
  const [dummySalt, setDummySalt] = useState<Uint8Array | null>(null)
  const [dummyKeyReady, setDummyKeyReady] = useState(false)

  // Initialize dummy key on mount
  useEffect(() => {
    if (shape === 'absent') {
      const initDummyKey = async () => {
        try {
          const salt = generateSalt()
          const key = await deriveKey(crypto.randomUUID(), salt)
          setDummySalt(salt)
          setDummyKey(key)
          setDummyKeyReady(true)
        } catch (err) {
          console.error('Failed to generate dummy key:', err)
        }
      }
      void initDummyKey()
    }
  }, [shape])

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

  // Conditional title/subtitle based on tab
  const title = gateTab === 'new' ? 'Set Encryption Password' : 'Restore from Google Drive'
  const subtitle =
    gateTab === 'new'
      ? 'Choose a password to encrypt your data on this device.'
      : 'Load your data stored in Google Drive.'

  // Tab control (only in 'absent' shape)
  const tabControl =
    shape === 'absent' ? (
      <div className="seg" style={{ marginBottom: 'var(--space-5)' }}>
        <label className="seg-opt">
          <input
            type="radio"
            name="gateTab"
            checked={gateTab === 'new'}
            readOnly
            onClick={() => setGateTab('new')}
          />
          New Setup
        </label>
        <label className="seg-opt">
          <input
            type="radio"
            name="gateTab"
            checked={gateTab === 'restore'}
            readOnly
            onClick={() => setGateTab('restore')}
          />
          Restore from Drive
        </label>
      </div>
    ) : null

  return (
    <GateShell
      title={title}
      subtitle={subtitle}
      onReset={onReset}
      tabControl={tabControl}
    >
      {/* New Setup Panel - always mounted, visibility toggled */}
      <div style={{ display: gateTab === 'new' ? 'block' : 'none' }}>
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
      </div>

      {/* Restore Panel - only rendered in 'absent' shape, always mounted, visibility toggled */}
      {shape === 'absent' && (
        <div style={{ display: gateTab === 'restore' ? 'block' : 'none' }}>
          {dummyKeyReady && dummyKey && dummySalt ? (
            <DriveRestorePanel
              driveReady={driveReady}
              driveEmail={driveEmail}
              backupFileId={backupFileId}
              syncing={syncing}
              setSyncing={setSyncing || (() => {})}
              handleConnect={handleConnect || (() => {})}
              handleDisconnect={handleDisconnect || (() => {})}
              restoreKey={dummyKey}
              restoreSalt={dummySalt}
              onRestored={(state, key, salt) => onUnlock(key, salt, state)}
            />
          ) : (
            <div style={{ padding: 'var(--space-3)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
              Loading restore options...
            </div>
          )}
        </div>
      )}
    </GateShell>
  )
}

function EnterPasswordScreen({
  onUnlock,
  onReset,
}: {
  onUnlock: (key: CryptoKey, salt: Uint8Array, migratedState?: AppState) => void
  onReset: () => Promise<void>
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
      onUnlock(key, salt as Uint8Array, loadedState ?? undefined)
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
      onReset={onReset}
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
