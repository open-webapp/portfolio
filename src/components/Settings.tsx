import { useCallback, useState } from 'react'
import type { AppState } from '../lib/state'
import { getDriveAuthStatus, syncBackup } from '../lib/drive'
import { deriveKey, generateSalt } from '../lib/crypto'
import { loadPersistedApp, savePersistedApp, clearPersistedApp } from '../lib/persist'
import { exportBackup, downloadEnvelopeAsFile } from '../lib/importExport'
import { DriveRestorePanel } from './DriveRestorePanel'
import { ResetAppControl } from './ResetAppControl'

export interface SettingsPageProps {
  state: AppState
  dispatch: (action: any) => void
  sessionKey: CryptoKey
  sessionSalt: Uint8Array
  onKeyChange: (newKey: CryptoKey, newSalt: Uint8Array) => void
  onPasswordEntryTimeReset: () => void
  driveReady: boolean
  driveEmail: string | null
  backupFileId: string | null
  syncing: boolean
  setSyncing: (v: boolean) => void
  handleConnect: () => void
  handleDisconnect: () => void
  settingsSection: 'drive' | 'importExport' | 'encryption' | 'priceSync'
  setSettingsSection: (s: 'drive' | 'importExport' | 'encryption' | 'priceSync') => void
  runPriceSyncTrigger: (overrideDate?: string) => Promise<void>
  runMutualFundSyncTrigger: () => Promise<void>
  tickerOverviewErrors: Record<string, string>
  mutualFundSyncErrors: Record<string, string>
  onReset: () => void
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
  onPasswordEntryTimeReset,
  driveReady,
  driveEmail,
  backupFileId,
  syncing,
  setSyncing,
  handleConnect,
  handleDisconnect,
  settingsSection,
  setSettingsSection,
  runPriceSyncTrigger,
  runMutualFundSyncTrigger,
  tickerOverviewErrors,
  mutualFundSyncErrors,
  onReset,
}: SettingsPageProps) {
  // Change Password local state
  const [currentPasswordInput, setCurrentPasswordInput] = useState('')
  const [newPasswordInput, setNewPasswordInput] = useState('')
  const [confirmNewPasswordInput, setConfirmNewPasswordInput] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null)
  const [driveSyncWarning, setDriveSyncWarning] = useState<string | null>(null)

  // Price Sync local state
  const [apiKeyInput, setApiKeyInput] = useState(state.priceSync.apiKey)
  const [fetchingPrices, setFetchingPrices] = useState(false)
  const [fetchDateInput, setFetchDateInput] = useState('')
  const priceSync = state.priceSync
  const [mfApiKeyInput, setMfApiKeyInput] = useState(state.mutualFundSync.apiKey)
  const [fetchingMutualFunds, setFetchingMutualFunds] = useState(false)
  const mutualFundSync = state.mutualFundSync

  const handleFetchPricesNow = useCallback(async () => {
    setFetchingPrices(true)
    try {
      await runPriceSyncTrigger(fetchDateInput || undefined)
    } finally {
      setFetchingPrices(false)
    }
  }, [runPriceSyncTrigger, fetchDateInput])

  const handleFetchMutualFundPricesNow = useCallback(async () => {
    setFetchingMutualFunds(true)
    try {
      await runMutualFundSyncTrigger()
    } finally {
      setFetchingMutualFunds(false)
    }
  }, [runMutualFundSyncTrigger])


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
      onPasswordEntryTimeReset()
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
  }, [currentPasswordInput, newPasswordInput, confirmNewPasswordInput, sessionSalt, state, onKeyChange, onPasswordEntryTimeReset])

  const handleResetApp = useCallback(async () => {
    await clearPersistedApp()
    onReset()
  }, [onReset])

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
            checked={settingsSection === 'importExport'}
            readOnly
            onClick={() => setSettingsSection('importExport')}
          />
          Download
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
        <label className="seg-opt">
          <input
            type="radio"
            name="settingsSection"
            checked={settingsSection === 'priceSync'}
            readOnly
            onClick={() => setSettingsSection('priceSync')}
          />
          Quotes API Key
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

      {/* Import/Export section */}
      {settingsSection === 'importExport' && (
      <section className="card blueprint elev-sm" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>Download</div>
        <button
          className="btn btn-primary blueprint"
          onClick={async () => {
            const envelope = await exportBackup(state, sessionKey, sessionSalt)
            const now = new Date()
            const yyyy = now.getFullYear()
            const mm = String(now.getMonth() + 1).padStart(2, '0')
            const dd = String(now.getDate()).padStart(2, '0')
            downloadEnvelopeAsFile(envelope, `ledger-backup-${yyyy}-${mm}-${dd}.json`)
          }}
        >
          Download Backup
        </button>
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

      {/* Danger Zone section */}
      {settingsSection === 'encryption' && (
      <section className="card blueprint elev-sm" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>Danger Zone</div>
        <p className="text-muted" style={{ fontSize: '13px', marginBottom: 'var(--space-4)' }}>
          This permanently deletes every encrypted account, position and transaction on this device. This cannot be
          undone.
        </p>
        <ResetAppControl onReset={handleResetApp} />
      </section>
      )}

      {/* Price Sync section */}
      {settingsSection === 'priceSync' && (
      <section className="card blueprint elev-sm" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>Quotes API Key</div>
        <div className="field">
          <label>Polygon.io API Key</label>
          <input
            type="password"
            className="input"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            onBlur={() => dispatch({ type: 'SET_PRICE_SYNC_API_KEY', apiKey: apiKeyInput })}
          />
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <button
            className="btn btn-primary blueprint"
            disabled={fetchingPrices || !priceSync.apiKey}
            onClick={handleFetchPricesNow}
          >
            {fetchingPrices ? 'Fetching prices...' : 'Fetch prices now'}
          </button>
          <input
            type="date"
            className="input"
            aria-label="Date to fetch"
            value={fetchDateInput}
            onChange={(e) => setFetchDateInput(e.target.value)}
            disabled={fetchingPrices}
          />
        </div>
        {priceSync.lastRun ? (
          <p>
            Last run: {new Date(priceSync.lastRun.at).toLocaleString()} —{' '}
            {priceSync.lastRun.error ? (
              <span style={{ color: '#8a3c2e' }}>{priceSync.lastRun.error}</span>
            ) : (
              <>
                {priceSync.lastRun.marketTickerCount.toLocaleString()} tickers fetched from Polygon —{' '}
                {priceSync.lastRun.updatedCount} updated
                {priceSync.lastRun.notFound.length > 0 &&
                  `, not found: ${priceSync.lastRun.notFound.join(', ')}`}
              </>
            )}
          </p>
        ) : (
          <p>Never run</p>
        )}
        {Object.keys(tickerOverviewErrors).length > 0 && (
          <ul className="error-list" style={{ color: '#8a3c2e' }}>
            {Object.entries(tickerOverviewErrors).map(([symbol, message]) => (
              <li key={symbol}>{symbol}: {message}</li>
            ))}
          </ul>
        )}
        <div style={{ marginTop: 'var(--space-5)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-color, #ddd)' }}>
          <div className="field">
            <label>Alphavantage API Key (Mutual Funds)</label>
            <input
              type="password"
              className="input"
              value={mfApiKeyInput}
              onChange={(e) => setMfApiKeyInput(e.target.value)}
              onBlur={() => dispatch({ type: 'SET_MUTUAL_FUND_SYNC_API_KEY', apiKey: mfApiKeyInput })}
            />
          </div>
          <button
            className="btn btn-primary blueprint"
            disabled={fetchingMutualFunds || !mutualFundSync.apiKey}
            onClick={handleFetchMutualFundPricesNow}
          >
            {fetchingMutualFunds ? 'Fetching mutual fund prices...' : 'Fetch mutual fund prices now'}
          </button>
          {mutualFundSync.lastRun ? (
            <p>
              Last run: {new Date(mutualFundSync.lastRun.at).toLocaleString()} —{' '}
              {mutualFundSync.lastRun.error ? (
                <span style={{ color: '#8a3c2e' }}>{mutualFundSync.lastRun.error}</span>
              ) : (
                <>
                  {mutualFundSync.lastRun.updatedCount} updated
                  {mutualFundSync.lastRun.notFound.length > 0 &&
                    `, not found: ${mutualFundSync.lastRun.notFound.join(', ')}`}
                </>
              )}
            </p>
          ) : (
            <p>Never run</p>
          )}
          {Object.keys(mutualFundSyncErrors).length > 0 && (
            <ul className="error-list" style={{ color: '#8a3c2e' }}>
              {Object.entries(mutualFundSyncErrors).map(([symbol, message]) => (
                <li key={symbol}>{symbol}: {message}</li>
              ))}
            </ul>
          )}
        </div>
      </section>
      )}
    </div>
  )
}
