import { useCallback, useState, useEffect } from 'react'
import type { AppState } from '../lib/state'
import {
  getDriveConnection,
  connectDrive,
  disconnectDrive,
  syncBackup,
  restoreBackup,
} from '../lib/drive'

export interface SettingsPageProps {
  state: AppState
  dispatch: (action: any) => void
}

/**
 * SettingsPage: Full-page settings view with Drive sync options.
 */
export function SettingsPage({ state, dispatch }: SettingsPageProps) {
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
    }
  }, [])

  const handleDisconnect = useCallback(async () => {
    setSyncing(true)
    try {
      await disconnectDrive()
      setDriveReady(false)
      alert('Disconnected from Drive')
    } catch (error) {
      console.error('Drive disconnect failed:', error)
      alert(`Disconnect failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSyncing(false)
    }
  }, [])

  return (
    <div>
      {/* Drive section */}
      <section className="card blueprint elev-sm" style={{ marginBottom: '24px' }}>
        <h2>Google Drive Sync</h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {!driveReady ? (
            <button onClick={handleConnect} disabled={syncing}>
              {syncing ? 'Connecting...' : 'Connect Drive'}
            </button>
          ) : (
            <>
              <button onClick={handleSync} disabled={syncing}>
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
              <button onClick={handleRestore} disabled={syncing}>
                {syncing ? 'Restoring...' : 'Restore from Drive'}
              </button>
              <button onClick={handleDisconnect} disabled={syncing}>
                {syncing ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </>
          )}
        </div>
      </section>

      {/* Import Sessions section */}
      <section className="card blueprint elev-sm" style={{ marginBottom: '24px' }}>
        <h2>Import Sessions</h2>
        {state.importSessions.length === 0 ? (
          <p>No imports yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date/Time</th>
                <th>Kind</th>
                <th>File Name</th>
                <th>Accounts</th>
                <th style={{ textAlign: 'right' }}>Row Count</th>
                <th style={{ width: '40px' }}></th>
              </tr>
            </thead>
            <tbody>
              {state.importSessions.map((session) => {
                const accountNames = session.accountIds
                  .map((id) => state.accounts.find((a) => a.id === id)?.name)
                  .filter((name) => name !== undefined)
                  .join(', ')

                const handleDelete = () => {
                  const confirmed = window.confirm(
                    `Delete this import? This will remove ${session.rowCount} positions/transactions.`
                  )
                  if (confirmed) {
                    dispatch({ type: 'DELETE_IMPORT_SESSION', sessionId: session.id })
                  }
                }

                return (
                  <tr key={session.id}>
                    <td className="text-muted">{session.importedAt}</td>
                    <td>{session.kind}</td>
                    <td>{session.fileName}</td>
                    <td>{accountNames}</td>
                    <td style={{ textAlign: 'right' }}>{session.rowCount}</td>
                    <td style={{ textAlign: 'center', paddingRight: '8px' }}>
                      <button
                        onClick={handleDelete}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--color-text-secondary)',
                          transition: 'color 0.2s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#8a3c2e')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
                        title="Delete this import session"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Accounts placeholder */}
      {/* Task 12 */}
    </div>
  )
}
