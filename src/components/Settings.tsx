import { useCallback, useState, useEffect } from 'react'
import type { AppState } from '../lib/state'
import { getDriveConnection, connectDrive, syncBackup, restoreBackup } from '../lib/drive'

export interface SettingsProps {
  state: AppState
  dispatch: (action: any) => void
}

/**
 * Settings: Button that opens a menu with Drive sync options (Connect, Sync Now, Restore).
 * Currently a minimal implementation with placeholder UI.
 */
export function Settings({ state, dispatch }: SettingsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [driveReady, setDriveReady] = useState(false)

  // Check Drive connection status on mount
  useEffect(() => {
    const checkDrive = async () => {
      const connection = await getDriveConnection()
      setDriveReady(connection !== null)
    }
    checkDrive()
  }, [])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      await syncBackup(state)
      alert('Synced to Drive')
    } catch (error) {
      console.error('Sync failed:', error)
      alert(`Sync failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSyncing(false)
      setIsOpen(false)
    }
  }, [state])

  const handleRestore = useCallback(async () => {
    if (!window.confirm('Restore will replace all data with the backed-up version. Continue?')) return

    setSyncing(true)
    try {
      const restored = await restoreBackup()
      if (restored) {
        dispatch({ type: '__SET_STATE', newState: restored })
        alert('Restored from Drive')
      } else {
        alert('No backup found on Drive')
      }
    } catch (error) {
      console.error('Restore failed:', error)
      alert(`Restore failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSyncing(false)
      setIsOpen(false)
    }
  }, [dispatch])

  const handleConnect = useCallback(async () => {
    setSyncing(true)
    try {
      await connectDrive()
      setDriveReady(true)
      alert('Connected to Drive')
    } catch (error) {
      console.error('Drive connect failed:', error)
      alert(`Connect failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSyncing(false)
      setIsOpen(false)
    }
  }, [])

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '8px 16px',
          borderRadius: '4px',
          border: '1px solid var(--color-divider)',
          background: 'var(--color-surface)',
          cursor: 'pointer',
          fontSize: '14px',
        }}
      >
        Settings ⚙️
      </button>

      {isOpen && (
        <>
          {/* Backdrop to close menu */}
          <div
            onClick={() => setIsOpen(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 99,
            }}
          />

          {/* Dropdown menu */}
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '8px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-divider)',
              borderRadius: '4px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
              zIndex: 100,
              minWidth: '200px',
            }}
          >
            {!driveReady && (
              <button
                onClick={handleConnect}
                disabled={syncing}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '12px 16px',
                  textAlign: 'left',
                  border: 'none',
                  background: 'transparent',
                  cursor: syncing ? 'wait' : 'pointer',
                  fontSize: '14px',
                  borderBottom: '1px solid var(--color-divider)',
                  opacity: syncing ? 0.6 : 1,
                }}
              >
                {syncing ? 'Connecting...' : 'Connect Drive'}
              </button>
            )}

            {driveReady && (
              <>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '12px 16px',
                    textAlign: 'left',
                    border: 'none',
                    background: 'transparent',
                    cursor: syncing ? 'wait' : 'pointer',
                    fontSize: '14px',
                    borderBottom: '1px solid var(--color-divider)',
                    opacity: syncing ? 0.6 : 1,
                  }}
                >
                  {syncing ? 'Syncing...' : 'Sync Now'}
                </button>
                <button
                  onClick={handleRestore}
                  disabled={syncing}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '12px 16px',
                    textAlign: 'left',
                    border: 'none',
                    background: 'transparent',
                    cursor: syncing ? 'wait' : 'pointer',
                    fontSize: '14px',
                    opacity: syncing ? 0.6 : 1,
                  }}
                >
                  {syncing ? 'Restoring...' : 'Restore from Drive'}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
