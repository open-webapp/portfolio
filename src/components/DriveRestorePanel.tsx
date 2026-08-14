import { useCallback, useState } from 'react'
import type { AppState } from '../lib/state'
import {
  restoreBackup,
  restoreBackupFromFileId,
  extractDriveFileId,
  DriveDecryptError,
} from '../lib/drive'
import { deriveKey, decryptState } from '../lib/crypto'

function DrivePasteFallback({
  value,
  onChange,
  onSubmit,
  error,
  restoring,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  error: string | null
  restoring: boolean
}) {
  return (
    <div style={{ marginTop: 'var(--space-3)' }}>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste Google Drive file link or ID"
        disabled={restoring}
        style={{ marginBottom: 'var(--space-2)', width: '100%' }}
      />
      {error && (
        <div style={{ color: 'var(--color-error)', fontSize: '0.85rem', marginBottom: 'var(--space-2)' }}>
          {error}
        </div>
      )}
      <button className="btn btn-secondary" onClick={onSubmit} disabled={restoring}>
        {restoring ? 'Loading...' : 'Load file'}
      </button>
    </div>
  )
}

export interface DriveRestorePanelProps {
  driveReady: boolean
  driveEmail: string | null
  backupFileId: string | null
  syncing: boolean
  setSyncing: (v: boolean) => void
  handleConnect: () => void
  handleDisconnect: () => void
  restoreKey: CryptoKey
  restoreSalt: Uint8Array
  onRestored: (state: AppState, key: CryptoKey, salt: Uint8Array) => void
}

export function DriveRestorePanel({
  driveReady,
  driveEmail,
  backupFileId,
  syncing,
  setSyncing,
  handleConnect,
  handleDisconnect,
  restoreKey,
  restoreSalt,
  onRestored,
}: DriveRestorePanelProps) {
  // Cross-password restore local state
  const [crossPasswordPrompt, setCrossPasswordPrompt] = useState<{
    salt: Uint8Array
    envelope: Parameters<typeof decryptState>[0]
  } | null>(null)
  const [backupPasswordInput, setBackupPasswordInput] = useState('')
  const [crossPasswordError, setCrossPasswordError] = useState<string | null>(null)
  const [restoringWithBackupPassword, setRestoringWithBackupPassword] = useState(false)

  // Fallback path when no backup exists under this account's own Drive
  // folder — e.g. the backup was shared with this account by a different
  // Google account rather than synced from it
  const [noBackupFound, setNoBackupFound] = useState(false)
  const [pasteInput, setPasteInput] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [loadingPastedFile, setLoadingPastedFile] = useState(false)

  const handleRestore = useCallback(async () => {
    if (!window.confirm('Restore will replace all data with the backed-up version. Continue?')) return

    setSyncing(true)
    setNoBackupFound(false)
    try {
      const restored = await restoreBackup(restoreKey)
      if (restored) {
        onRestored(restored, restoreKey, restoreSalt)
        alert('Restored from Drive')
      } else {
        setNoBackupFound(true)
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
  }, [restoreKey, restoreSalt, onRestored, setSyncing])

  const handleLoadPastedFile = useCallback(async () => {
    const fileId = extractDriveFileId(pasteInput)
    if (!fileId) {
      setPasteError("Couldn't find a file ID in that link")
      return
    }

    if (!window.confirm('Restore will replace all data with the backed-up version. Continue?')) return

    setLoadingPastedFile(true)
    setPasteError(null)
    try {
      const restored = await restoreBackupFromFileId(fileId, restoreKey)
      onRestored(restored, restoreKey, restoreSalt)
      setNoBackupFound(false)
      setCrossPasswordPrompt(null)
      setCrossPasswordError(null)
      alert('Restored from Drive')
    } catch (error) {
      if (error instanceof DriveDecryptError) {
        setCrossPasswordPrompt({ salt: error.salt, envelope: error.envelope })
        setCrossPasswordError(null)
        setBackupPasswordInput('')
        return
      }
      console.error('Restore from pasted file ID failed:', error)
      alert(`Restore failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoadingPastedFile(false)
    }
  }, [pasteInput, restoreKey, restoreSalt, onRestored])

  const handleCrossPasswordSubmit = useCallback(async () => {
    if (!crossPasswordPrompt) return
    setCrossPasswordError(null)
    setRestoringWithBackupPassword(true)
    try {
      const retryKey = await deriveKey(backupPasswordInput, crossPasswordPrompt.salt)
      const decryptedState = await decryptState(crossPasswordPrompt.envelope, retryKey)
      onRestored(decryptedState, retryKey, crossPasswordPrompt.salt)
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
  }, [crossPasswordPrompt, backupPasswordInput, onRestored, setSyncing])

  return (
    <>
      {/* Google Account Connection Status */}
      {!driveReady ? (
        <button className="btn btn-primary blueprint" onClick={handleConnect} disabled={syncing}>
          {syncing ? 'Connecting...' : 'Connect Google Account'}
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <div style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: 'var(--color-success)',
              flexShrink: 0,
            }} />
            <span style={{ fontFamily: 'var(--sans-serif)', fontSize: '0.95rem' }}>{driveEmail}</span>
          </div>
          <span
            onClick={handleDisconnect}
            style={{
              cursor: 'pointer',
              textDecoration: 'underline',
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              marginBottom: 'var(--space-4)',
              display: 'inline-block',
            }}
          >
            Disconnect
          </span>
        </>
      )}

      {/* Restore Button */}
      {driveReady && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <button className="btn btn-secondary" onClick={handleRestore} disabled={syncing}>
            {syncing ? 'Restoring...' : 'Restore from Drive'}
          </button>
        </div>
      )}

      {/* Backup Link */}
      {backupFileId && driveReady && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <a
            href={`https://drive.google.com/file/d/${backupFileId}/view`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              textDecoration: 'underline',
            }}
          >
            View backup in Google Drive
          </a>
        </div>
      )}

      {/* No Backup Found Fallback */}
      {noBackupFound && (
        <DrivePasteFallback
          value={pasteInput}
          onChange={setPasteInput}
          onSubmit={handleLoadPastedFile}
          error={pasteError}
          restoring={loadingPastedFile}
        />
      )}

      {/* Cross-Password Prompt */}
      {crossPasswordPrompt && (
        <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', backgroundColor: 'var(--color-bg-secondary)', borderRadius: '4px' }}>
          <p style={{ fontSize: '0.9rem', marginBottom: 'var(--space-3)' }}>
            This backup was saved with a different encryption password. Enter that password to restore:
          </p>
          <input
            type="password"
            value={backupPasswordInput}
            onChange={(e) => setBackupPasswordInput(e.target.value)}
            placeholder="Backup password"
            className="input"
            style={{ marginBottom: 'var(--space-3)', width: '100%' }}
            disabled={restoringWithBackupPassword}
          />
          {crossPasswordError && (
            <div style={{ color: 'var(--color-error)', fontSize: '0.85rem', marginBottom: 'var(--space-3)' }}>
              {crossPasswordError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            <button
              className="btn btn-primary blueprint"
              onClick={handleCrossPasswordSubmit}
              disabled={restoringWithBackupPassword}
            >
              Restore with this password
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
            <DrivePasteFallback
              value={pasteInput}
              onChange={setPasteInput}
              onSubmit={handleLoadPastedFile}
              error={pasteError}
              restoring={loadingPastedFile}
            />
          )}
        </div>
      )}
    </>
  )
}
