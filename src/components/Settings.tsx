import { useCallback, useState, useEffect } from 'react'
import type { AppState } from '../lib/state'
import type { TaxCategory } from '../lib/types'
import {
  getDriveConnection,
  getBackupFileId,
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
  const [backupFileId, setBackupFileId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'general' | 'importSessions'>('general')

  // Check Drive connection status on mount
  useEffect(() => {
    const checkDrive = async () => {
      const connection = await getDriveConnection()
      setDriveReady(connection !== null)
      if (connection) {
        const fileId = await getBackupFileId()
        setBackupFileId(fileId)
      }
    }
    checkDrive()
  }, [])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      const fileId = await syncBackup(state)
      setBackupFileId(fileId)
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
      const fileId = await getBackupFileId()
      setBackupFileId(fileId)
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
      setBackupFileId(null)
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
      {/* Settings tabs */}
      <div className="seg" style={{ marginBottom: '24px' }}>
        {[
          { value: 'general', label: 'General' },
          { value: 'importSessions', label: 'Import Sessions' },
        ].map((tab) => (
          <label
            key={tab.value}
            className="seg-opt"
            onClick={() => setActiveTab(tab.value as 'general' | 'importSessions')}
          >
            <input
              type="radio"
              name="settings-tab"
              checked={activeTab === tab.value}
              readOnly
            />
            <span>{tab.label}</span>
          </label>
        ))}
      </div>

      {activeTab === 'general' && (
        <>
          {/* Accounts section */}
          <section className="card blueprint elev-sm" style={{ marginBottom: '24px' }}>
            <h2>Accounts</h2>
            {state.accounts.length === 0 ? (
              <p>No accounts yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Account Number</th>
                    <th>Name</th>
                    <th>Tax Category</th>
                    <th>Retirement</th>
                    <th style={{ width: '40px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {state.accounts.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      dispatch={dispatch}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Drive section */}
          <section className="card blueprint elev-sm" style={{ marginBottom: '24px' }}>
            <h2>Google Drive Sync</h2>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {!driveReady ? (
                <button className="btn btn-primary" onClick={handleConnect} disabled={syncing}>
                  {syncing ? 'Connecting...' : 'Connect Drive'}
                </button>
              ) : (
                <>
                  <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
                    {syncing ? 'Syncing...' : 'Sync Now'}
                  </button>
                  <button className="btn btn-secondary" onClick={handleRestore} disabled={syncing}>
                    {syncing ? 'Restoring...' : 'Restore from Drive'}
                  </button>
                  <button className="btn btn-secondary" onClick={handleDisconnect} disabled={syncing}>
                    {syncing ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                </>
              )}
            </div>
            {driveReady && backupFileId && (
              <p style={{ marginTop: '12px', marginBottom: 0 }}>
                <a
                  href={`https://drive.google.com/file/d/${backupFileId}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View backup in Google Drive
                </a>
              </p>
            )}
          </section>
        </>
      )}

      {activeTab === 'importSessions' && (
        <>
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
        </>
      )}
    </div>
  )
}

function AccountRow({
  account,
  dispatch,
}: {
  account: AppState['accounts'][number]
  dispatch: (action: any) => void
}) {
  const [isEditingName, setIsEditingName] = useState(false)
  const [editedName, setEditedName] = useState(account.name)
  const [isEditingAccountNumber, setIsEditingAccountNumber] = useState(false)
  const [editedAccountNumber, setEditedAccountNumber] = useState(account.accountNumber)

  const handleNameBlur = () => {
    if (editedName.trim() && editedName !== account.name) {
      dispatch({
        type: 'UPDATE_ACCOUNT',
        accountId: account.id,
        patch: { name: editedName.trim() },
      })
    }
    setEditedName(account.name)
    setIsEditingName(false)
  }

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleNameBlur()
    } else if (e.key === 'Escape') {
      setEditedName(account.name)
      setIsEditingName(false)
    }
  }

  const handleAccountNumberBlur = () => {
    if (editedAccountNumber.trim() && editedAccountNumber !== account.accountNumber) {
      dispatch({
        type: 'UPDATE_ACCOUNT',
        accountId: account.id,
        patch: { accountNumber: editedAccountNumber.trim() },
      })
    }
    setEditedAccountNumber(account.accountNumber)
    setIsEditingAccountNumber(false)
  }

  const handleAccountNumberKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleAccountNumberBlur()
    } else if (e.key === 'Escape') {
      setEditedAccountNumber(account.accountNumber)
      setIsEditingAccountNumber(false)
    }
  }

  const handleTaxCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newCategory = e.target.value as TaxCategory
    dispatch({
      type: 'UPDATE_ACCOUNT',
      accountId: account.id,
      patch: { taxCategory: newCategory },
    })
  }

  const handleRetirementChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch({
      type: 'UPDATE_ACCOUNT',
      accountId: account.id,
      patch: { retirement: e.target.checked },
    })
  }

  const handleDelete = () => {
    const confirmed = window.confirm(
      'Delete this account? This removes all its positions, closed positions, transactions, and snapshots.'
    )
    if (confirmed) {
      dispatch({ type: 'DELETE_ACCOUNT', accountId: account.id })
    }
  }

  return (
    <tr>
      <td>
        {isEditingAccountNumber ? (
          <input
            className="input"
            type="text"
            value={editedAccountNumber}
            onChange={(e) => setEditedAccountNumber(e.target.value)}
            onBlur={handleAccountNumberBlur}
            onKeyDown={handleAccountNumberKeyDown}
            autoFocus
            style={{ width: '100%' }}
          />
        ) : (
          <span
            onClick={() => setIsEditingAccountNumber(true)}
            style={{ cursor: 'pointer', textDecoration: 'underline' }}
            title="Click to edit"
          >
            {account.accountNumber}
          </span>
        )}
      </td>
      <td>
        {isEditingName ? (
          <input
            className="input"
            type="text"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={handleNameKeyDown}
            autoFocus
            style={{ width: '100%' }}
          />
        ) : (
          <span
            onClick={() => setIsEditingName(true)}
            style={{ cursor: 'pointer', textDecoration: 'underline' }}
            title="Click to edit"
          >
            {account.name}
          </span>
        )}
      </td>
      <td>
        <select
          className="input"
          value={account.taxCategory}
          onChange={handleTaxCategoryChange}
          style={{ width: '100%' }}
        >
          <option value="taxable">Taxable</option>
          <option value="nonTaxable">Non-Taxable</option>
          <option value="taxDeferred">Tax-Deferred</option>
        </select>
      </td>
      <td>
        <input
          type="checkbox"
          checked={account.retirement}
          onChange={handleRetirementChange}
        />
      </td>
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
          title="Delete this account"
        >
          ✕
        </button>
      </td>
    </tr>
  )
}
