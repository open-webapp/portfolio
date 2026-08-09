import { useCallback, useState, useEffect } from 'react'
import type { AppState } from '../lib/state'
import type { TaxCategory } from '../lib/types'
import { InstitutionSelect } from './InstitutionSelect'
import {
  getBackupFileId,
  connectDrive,
  disconnectDrive,
  syncBackup,
  restoreBackup,
  getDriveAuthStatus,
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
}

/**
 * SettingsPage: Full-page settings view with Drive sync options.
 */
export function SettingsPage({ state, dispatch, sessionKey, sessionSalt, onKeyChange }: SettingsPageProps) {
  const [syncing, setSyncing] = useState(false)
  const [driveReady, setDriveReady] = useState(false)
  const [driveEmail, setDriveEmail] = useState<string | null>(null)
  const [backupFileId, setBackupFileId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'general' | 'importSessions'>('general')

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

  // Check Drive connection status on mount (never opens a Google auth window)
  useEffect(() => {
    const checkDrive = async () => {
      try {
        const authStatus = await getDriveAuthStatus()
        setDriveReady(authStatus.connected)
        setDriveEmail(authStatus.email)
        if (authStatus.connected) {
          const fileId = await getBackupFileId()
          setBackupFileId(fileId)
        }
      } catch (error) {
        console.error('Failed to check Drive connection:', error)
      }
    }
    checkDrive()
  }, [])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      const fileId = await syncBackup(state, sessionKey, sessionSalt)
      setBackupFileId(fileId)
      alert('Synced to Drive')
    } catch (error) {
      console.error('Sync failed:', error)
      alert(`Sync failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSyncing(false)
    }
  }, [state, sessionKey, sessionSalt])

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
  }, [dispatch, sessionKey])

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
  }, [crossPasswordPrompt, backupPasswordInput, dispatch, onKeyChange])

  const handleConnect = useCallback(async () => {
    setSyncing(true)
    try {
      const connection = await connectDrive()
      setDriveReady(true)
      setDriveEmail(connection.email)
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
      setDriveEmail(null)
      setBackupFileId(null)
      alert('Disconnected from Drive')
    } catch (error) {
      console.error('Drive disconnect failed:', error)
      alert(`Disconnect failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSyncing(false)
    }
  }, [])

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
            <h2 style={{ textAlign: 'left' }}>Accounts</h2>
            {state.accounts.length === 0 ? (
              <p>No accounts yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Account Number</th>
                    <th>Name</th>
                    <th>Institution</th>
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
                      accounts={state.accounts}
                      dispatch={dispatch}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Google Drive Sync section */}
          <section className="card blueprint elev-sm" style={{ marginBottom: '24px' }}>
            <h2 style={{ textAlign: 'left' }}>Google Drive Sync</h2>
            
            <div style={{ maxWidth: '460px' }}>
              {/* Google Account subsection */}
              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ 
                  fontSize: '11px', 
                  fontWeight: 600, 
                  letterSpacing: '0.06em', 
                  color: 'color-mix(in srgb, var(--color-text) 60%, transparent)', 
                  textTransform: 'uppercase',
                  marginBottom: '8px',
                  marginTop: 0
                }}>
                  Google Account
                </h3>
                
                {!driveReady ? (
                  <button className="btn btn-primary" onClick={handleConnect} disabled={syncing}>
                    {syncing ? 'Connecting...' : 'Connect Google Account'}
                  </button>
                ) : (
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    border: '1px solid var(--color-divider)',
                    borderRadius: 'var(--radius-md)',
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
                        color: 'var(--color-accent)', 
                        cursor: 'pointer',
                        textDecoration: 'none'
                      }}
                    >
                      Disconnect
                    </span>
                  </div>
                )}
              </div>

              {/* Drive Sync Actions (only when connected) */}
              {driveReady && (
                <>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
                      {syncing ? 'Syncing...' : 'Sync Now'}
                    </button>
                    <button className="btn btn-secondary" onClick={handleRestore} disabled={syncing}>
                      {syncing ? 'Restoring...' : 'Restore from Drive'}
                    </button>
                  </div>
                  {backupFileId && (
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
                </>
              )}
            </div>
            {crossPasswordPrompt && (
              <div style={{ marginTop: '16px', maxWidth: '460px' }}>
                <p>This backup was saved with a different encryption password. Enter that password to restore:</p>
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
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn btn-primary"
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
                  <p style={{ marginTop: '12px', marginBottom: 0, color: '#8a3c2e' }}>{crossPasswordError}</p>
                )}
              </div>
            )}
          </section>

          {/* Change Encryption Password section */}
          <section className="card blueprint elev-sm" style={{ marginBottom: '24px' }}>
            <h2 style={{ textAlign: 'left' }}>Change Encryption Password</h2>
            <div style={{ maxWidth: '460px' }}>
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
                className="btn btn-primary"
                onClick={handleChangePassword}
                disabled={changingPassword}
              >
                {changingPassword ? 'Changing Encryption Password...' : 'Change Encryption Password'}
              </button>
              {passwordError && (
                <p style={{ marginTop: '12px', marginBottom: 0, color: '#8a3c2e' }}>{passwordError}</p>
              )}
              {passwordSuccess && (
                <p style={{ marginTop: '12px', marginBottom: 0 }}>{passwordSuccess}</p>
              )}
              {driveSyncWarning && (
                <p style={{ marginTop: '12px', marginBottom: 0, color: '#8a3c2e' }}>{driveSyncWarning}</p>
              )}
            </div>
          </section>
        </>
      )}

      {activeTab === 'importSessions' && (
        <>
          {/* Import Sessions section */}
          <section className="card blueprint elev-sm" style={{ marginBottom: '24px' }}>
            <h2 style={{ textAlign: 'left' }}>Import Sessions</h2>
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
                    <th>Row Count</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {state.importSessions.map((session) => (
                    <tr key={session.id}>
                      <td>{new Date(session.importedAt).toLocaleString()}</td>
                      <td>{session.kind === 'positions' ? 'Positions' : 'Transactions'}</td>
                      <td>{session.fileName}</td>
                      <td>
                        {session.accountIds
                          .map((id) => state.accounts.find((a) => a.id === id)?.name || id)
                          .join(', ')}
                      </td>
                      <td>{session.rowCount}</td>
                      <td>
                        <button
                          title="Delete this import session"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete this import? This will remove ${session.rowCount} positions/transactions.`
                              )
                            ) {
                              dispatch({ type: 'DELETE_IMPORT_SESSION', sessionId: session.id })
                            }
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#8a3c2e',
                            fontSize: '18px',
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
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
  accounts,
  dispatch,
}: {
  account: AppState['accounts'][number]
  accounts: AppState['accounts']
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

  const handleInstitutionChange = (value: string) => {
    dispatch({
      type: 'UPDATE_ACCOUNT',
      accountId: account.id,
      patch: { institution: value },
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
        <InstitutionSelect
          value={account.institution}
          accounts={accounts}
          onChange={handleInstitutionChange}
        />
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
