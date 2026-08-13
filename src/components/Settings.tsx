import { useCallback, useState } from 'react'
import type { AppState } from '../lib/state'
import {
  restoreBackup,
  getDriveAuthStatus,
  syncBackup,
  DriveDecryptError,
} from '../lib/drive'
import { deriveKey, decryptState, generateSalt } from '../lib/crypto'
import { loadPersistedApp, savePersistedApp } from '../lib/persist'

export interface SettingsPageProps {
  state: AppState
  dispatch: (action: any) => void
  sessionKey: CryptoKey
  sessionSalt: Uint8Array
  onKeyChange: (newKey: CryptoKey, newSalt: Uint8Array) => void
  driveReady: boolean
  driveEmail: string | null
  backupFileId: string | null
  syncing: boolean
  setSyncing: (v: boolean) => void
  handleConnect: () => void
  handleDisconnect: () => void
  handleSync: () => void
  settingsSection: 'drive' | 'encryption'
  setSettingsSection: (s: 'drive' | 'encryption') => void
}

/**
 * SettingsPage: Full-page settings view with Drive sync options.
 */
export function SettingsPage({
  state,
  dispatch,
  sessionKey,
  sessionSalt,
  onKeyChange,
  driveReady,
  driveEmail,
  backupFileId,
  syncing,
  setSyncing,
  handleConnect,
  handleDisconnect,
  handleSync,
  settingsSection,
  setSettingsSection,
}: SettingsPageProps) {
  // Change Password local state
  const [currentPasswordInput, setCurrentPasswordInput] = useState('')
  const [newPasswordInput, setNewPasswordInput] = useState('')
  const [confirmNewPasswordInput, setConfirmNewPasswordInput] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null)
  const [driveSyncWarning, setDriveSyncWarning] = useState<string | null>(null)

  // Cross-password restore local state
  const [crossPasswordPrompt, setCrossPasswordPrompt] = useState<{
    salt: Uint8Array
    envelope: Parameters<typeof decryptState>[0]
  } | null>(null)
  const [backupPasswordInput, setBackupPasswordInput] = useState('')
  const [crossPasswordError, setCrossPasswordError] = useState<string | null>(null)
  const [restoringWithBackupPassword, setRestoringWithBackupPassword] = useState(false)

  const handleRestore = useCallback(async () => {
    if (!window.confirm('Restore will replace all data with the backed-up version. Continue?')) return

    setSyncing(true)
    try {
      const restored = await restoreBackup(sessionKey)
      if (restored) {
        dispatch({ type: '__SET_STATE', newState: restored })
        alert('Restored from Drive')
      } else {
        alert('No backup found on Drive')
      }
    } catch (error) {
      if (error instanceof DriveDecryptError) {
        setCrossPasswordPrompt({ salt: error.salt, envelope: error.envelope })
        setCrossPasswordError(null)
        setBackupPasswordInput('')
        return
      }
      console.error('Restore failed:', error)
      alert(`Restore failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSyncing(false)
    }
  }, [dispatch, sessionKey, setSyncing])

  const handleCrossPasswordSubmit = useCallback(async () => {
    if (!crossPasswordPrompt) return
    setCrossPasswordError(null)
    setRestoringWithBackupPassword(true)
    try {
      const retryKey = await deriveKey(backupPasswordInput, crossPasswordPrompt.salt)
      const decryptedState = await decryptState(crossPasswordPrompt.envelope, retryKey)
      dispatch({ type: '__SET_STATE', newState: decryptedState })
      onKeyChange(retryKey, crossPasswordPrompt.salt)
      setCrossPasswordPrompt(null)
      setBackupPasswordInput('')
      alert('Restored from Drive')
    } catch (error) {
      console.error('Cross-password restore failed:', error)
      setCrossPasswordError('Incorrect encryption password')
    } finally {
      setRestoringWithBackupPassword(false)
      setSyncing(false)
    }
  }, [crossPasswordPrompt, backupPasswordInput, dispatch, onKeyChange, setSyncing])

  const handleChangePassword = useCallback(async () => {
    setPasswordError(null)
    setPasswordSuccess(null)
    setDriveSyncWarning(null)
    setChangingPassword(true)
    try {
      // Verify the current password by attempting to decrypt with it.
      let candidateKey: CryptoKey
      try {
        candidateKey = await deriveKey(currentPasswordInput, sessionSalt)
        await loadPersistedApp(candidateKey)
      } catch (error) {
        console.error('Current password verification failed:', error)
        setPasswordError('Current encryption password is incorrect')
        return
      }

      if (newPasswordInput.length < 6) {
        setPasswordError('Encryption password must be at least 6 characters')
        return
      }
      if (newPasswordInput !== confirmNewPasswordInput) {
        setPasswordError('Encryption passwords do not match')
        return
      }

      const newSalt = generateSalt()
      const newKey = await deriveKey(newPasswordInput, newSalt)

      await savePersistedApp(state, newKey, newSalt)

      let syncWarning: string | null = null
      try {
        const driveStatus = await getDriveAuthStatus()
        if (driveStatus.connected) {
          await syncBackup(state, newKey, newSalt)
        }
      } catch (error) {
        console.error('Drive re-sync after password change failed:', error)
        const message = error instanceof Error ? error.message : String(error)
        syncWarning = `Encryption password changed locally, but Drive re-sync failed: ${message}. Sync manually from Google Drive Sync above.`
      }

      onKeyChange(newKey, newSalt)
      setCurrentPasswordInput('')
      setNewPasswordInput('')
      setConfirmNewPasswordInput('')
      setPasswordSuccess('Encryption password changed')
      if (syncWarning) {
        setDriveSyncWarning(syncWarning)
      }
    } finally {
      setChangingPassword(false)
    }
  }, [currentPasswordInput, newPasswordInput, confirmNewPasswordInput, sessionSalt, state, onKeyChange])

  return (
    <div>
      {/* Settings tab-seg */}
      <div className="seg" style={{ marginBottom: 'var(--space-5)' }}>
        <label className="seg-opt">
          <input
            type="radio"
            name="settingsSection"
            checked={settingsSection === 'drive'}
            readOnly
            onClick={() => setSettingsSection('drive')}
          />
          Google Drive
        </label>
        <label className="seg-opt">
          <input
            type="radio"
            name="settingsSection"
            checked={settingsSection === 'encryption'}
            readOnly
            onClick={() => setSettingsSection('encryption')}
          />
          Encryption
        </label>
      </div>
      <div className="hr" style={{ marginBottom: 'var(--space-5)' }} />

      {/* Google Drive Sync section */}
      {settingsSection === 'drive' && (
      <section className="card blueprint elev-sm" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>Google Drive Sync</div>

        {/* Google Account subsection */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div className="text-muted" style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            marginBottom: 'var(--space-2)'
          }}>
            Google Account
          </div>

          {!driveReady ? (
            <button className="btn btn-primary blueprint" onClick={handleConnect} disabled={syncing}>
              {syncing ? 'Connecting...' : 'Connect Google Account'}
            </button>
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              border: '1px solid var(--color-divider)',
              backgroundColor: 'var(--color-surface)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: '#2BAE66',
                    flexShrink: 0
                  }}
                />
                <span style={{ fontSize: '13px', color: 'var(--color-text)' }}>
                  {driveEmail || 'Connected'}
                </span>
              </div>
              <span
                onClick={handleDisconnect}
                style={{
                  fontSize: '12px',
                  color: 'var(--color-accent-700)',
                  cursor: 'pointer'
                }}
              >
                Disconnect
              </span>
            </div>
          )}
        </div>

        {/* Drive Sync Actions (only when connected) */}
        {driveReady && (
          <div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <button className="btn btn-primary blueprint" onClick={handleSync} disabled={syncing}>
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
              <button className="btn btn-secondary" onClick={handleRestore} disabled={syncing}>
                {syncing ? 'Restoring...' : 'Restore from Drive'}
              </button>
            </div>
            {backupFileId && (
              <p style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
                <a
                  href={`https://drive.google.com/file/d/${backupFileId}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View backup in Google Drive
                </a>
              </p>
            )}
          </div>
        )}
        {crossPasswordPrompt && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <p style={{ fontSize: '13px', marginBottom: 'var(--space-3)' }}>
              This backup was saved with a different encryption password. Enter that password to restore:
            </p>
            <div className="field">
              <label>Backup Encryption Password</label>
              <input
                className="input"
                type="password"
                value={backupPasswordInput}
                onChange={(e) => setBackupPasswordInput(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                className="btn btn-primary blueprint"
                onClick={handleCrossPasswordSubmit}
                disabled={restoringWithBackupPassword}
              >
                {restoringWithBackupPassword ? 'Restoring...' : 'Restore with this password'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setCrossPasswordPrompt(null)
                  setBackupPasswordInput('')
                  setCrossPasswordError(null)
                }}
                disabled={restoringWithBackupPassword}
              >
                Cancel
              </button>
            </div>
            {crossPasswordError && (
              <p style={{ marginTop: 'var(--space-3)', marginBottom: 0, color: '#8a3c2e' }}>{crossPasswordError}</p>
            )}
          </div>
        )}
      </section>
      )}

      {/* Change Encryption Password section */}
      {settingsSection === 'encryption' && (
      <section className="card blueprint elev-sm" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>Change Encryption Password</div>
        <div className="field">
          <label>Current Encryption Password</label>
          <input
            className="input"
            type="password"
            value={currentPasswordInput}
            onChange={(e) => setCurrentPasswordInput(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div className="field">
          <label>New Encryption Password</label>
          <input
            className="input"
            type="password"
            value={newPasswordInput}
            onChange={(e) => setNewPasswordInput(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="field">
          <label>Confirm New Encryption Password</label>
          <input
            className="input"
            type="password"
            value={confirmNewPasswordInput}
            onChange={(e) => setConfirmNewPasswordInput(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <button
          className="btn btn-primary blueprint"
          onClick={handleChangePassword}
          disabled={changingPassword}
        >
          {changingPassword ? 'Changing Encryption Password...' : 'Change Encryption Password'}
        </button>
        {passwordError && (
          <p style={{ marginTop: 'var(--space-3)', marginBottom: 0, color: '#8a3c2e' }}>{passwordError}</p>
        )}
        {passwordSuccess && (
          <p style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>{passwordSuccess}</p>
        )}
        {driveSyncWarning && (
          <p style={{ marginTop: 'var(--space-3)', marginBottom: 0, color: '#8a3c2e' }}>{driveSyncWarning}</p>
        )}
      </section>
      )}
    </div>
  )
}
