import { useCallback, useState } from 'react'
import type { AppState } from '../lib/state'
import { getDriveAuthStatus, syncBackup } from '../lib/drive'
import { deriveKey, generateSalt } from '../lib/crypto'
import { loadPersistedApp, savePersistedApp } from '../lib/persist'
import { DriveRestorePanel } from './DriveRestorePanel'

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
        <DriveRestorePanel
          driveReady={driveReady}
          driveEmail={driveEmail}
          backupFileId={backupFileId}
          syncing={syncing}
          setSyncing={setSyncing}
          handleConnect={handleConnect}
          handleDisconnect={handleDisconnect}
          restoreKey={sessionKey}
          restoreSalt={sessionSalt}
          onRestored={(state, key, salt) => {
            dispatch({ type: '__SET_STATE', newState: state })
            onKeyChange(key, salt)
          }}
        />
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
