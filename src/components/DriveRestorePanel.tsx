import { useCallback, useEffect, useState } from 'react'
import type { AppState } from '../lib/state'
import {
  restoreBackupFromFileId,
  openDrivePicker,
  getAccessTokenForPicker,
  DriveDecryptError,
} from '../lib/drive'
import { deriveKey, decryptState } from '../lib/crypto'

function DrivePickerFallback({
  onSelect,
  onCancel,
  restoring,
}: {
  onSelect: (fileId: string) => void
  onCancel: () => void
  restoring: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [pickerLoading, setPickerLoading] = useState(false)

  useEffect(() => {
    // Open Picker immediately when this component mounts (i.e. as soon
    // as the user clicks "Restore from Drive" — no lookup step first).
    const openPicker = async () => {
      if (pickerLoading || restoring) return

      setPickerLoading(true)
      setError(null)
      try {
        const token = await getAccessTokenForPicker()
        await openDrivePicker(
          token,
          (fileId: string) => {
            setPickerLoading(false)
            onSelect(fileId)
          },
          () => {
            setPickerLoading(false)
            onCancel()
          }
        )
      } catch (err) {
        setPickerLoading(false)
        setError(`Failed to open file picker: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    openPicker()
  }, [onSelect, onCancel, pickerLoading, restoring])

  if (error) {
    return (
      <div style={{ marginTop: 'var(--space-3)', color: 'var(--color-error)', fontSize: '0.9rem' }}>
        {error}
        <button
          className="btn btn-secondary"
          onClick={() => setError(null)}
          style={{ marginTop: 'var(--space-2)' }}
        >
          Retry
        </button>
      </div>
    )
  }

  if (pickerLoading) {
    return (
      <div style={{ marginTop: 'var(--space-3)', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
        Opening file picker...
      </div>
    )
  }

  return null
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

  // Show the Picker when user clicks "Restore from Drive"
  const [showPicker, setShowPicker] = useState(false)

  function handleRestore() {
    // Picker is the only restore entry point — always open it immediately,
    // no by-name lookup in the app's own Drive folder first.
    setShowPicker(true)
  }


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

      {/* File Picker Fallback */}
      {showPicker && (
        <DrivePickerFallback
          onSelect={async (fileId: string) => {
            if (!window.confirm('Restore will replace all data with the backed-up version. Continue?')) return

            setSyncing(true)
            try {
              const restored = await restoreBackupFromFileId(fileId, restoreKey)
              onRestored(restored, restoreKey, restoreSalt)
              setShowPicker(false)
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
              console.error('Restore from picked file failed:', error)
              alert(`Restore failed: ${error instanceof Error ? error.message : String(error)}`)
            } finally {
              setSyncing(false)
            }
          }}
          onCancel={() => {
            // User closed Picker without selecting — reset so "Restore from
            // Drive" can be clicked again to reopen it.
            setShowPicker(false)
          }}
          restoring={syncing}
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
            <DrivePickerFallback
              onSelect={async (fileId: string) => {
                if (!window.confirm('Restore will replace all data with the backed-up version. Continue?')) return

                setSyncing(true)
                try {
                  const restored = await restoreBackupFromFileId(fileId, restoreKey)
                  onRestored(restored, restoreKey, restoreSalt)
                  setCrossPasswordPrompt(null)
                  setCrossPasswordError(null)
                  setBackupPasswordInput('')
                  alert('Restored from Drive')
                } catch (error) {
                  if (error instanceof DriveDecryptError) {
                    setCrossPasswordPrompt({ salt: error.salt, envelope: error.envelope })
                    setCrossPasswordError(null)
                    setBackupPasswordInput('')
                    return
                  }
                  console.error('Restore from picked file failed:', error)
                  alert(`Restore failed: ${error instanceof Error ? error.message : String(error)}`)
                } finally {
                  setSyncing(false)
                }
              }}
              onCancel={() => {
                // User closed Picker during cross-password retry — state unchanged
              }}
              restoring={syncing}
            />
          )}
        </div>
      )}
    </>
  )
}
