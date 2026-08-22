import { useCallback, useEffect, useState } from 'react'
import type { AppState } from '../lib/state'
import { getDriveAuthStatus, syncBackup } from '../lib/drive'
import { deriveKey, generateSalt } from '../lib/crypto'
import { loadPersistedApp, savePersistedApp } from '../lib/persist'
import { fmtUSD } from '../lib/computations'
import { getAllBars, type DailyBar } from '../lib/marketDataDb'
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
  settingsSection: 'drive' | 'encryption' | 'priceSync'
  setSettingsSection: (s: 'drive' | 'encryption' | 'priceSync') => void
  runPriceSyncTrigger: (overrideDate?: string) => Promise<void>
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
  runPriceSyncTrigger,
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
  const [priceSyncSearch, setPriceSyncSearch] = useState('')
  const [allBars, setAllBars] = useState<DailyBar[]>([])
  const priceSync = state.priceSync

  // marketDataDb caches every ticker Polygon returns (not just held symbols) —
  // reload it whenever a new sync run completes so the table below stays current.
  useEffect(() => {
    let cancelled = false
    getAllBars().then((bars) => {
      if (!cancelled) setAllBars(bars)
    })
    return () => {
      cancelled = true
    }
  }, [priceSync.lastRun?.at])

  const handleFetchPricesNow = useCallback(async () => {
    setFetchingPrices(true)
    try {
      await runPriceSyncTrigger(fetchDateInput || undefined)
    } finally {
      setFetchingPrices(false)
    }
  }, [runPriceSyncTrigger, fetchDateInput])


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
        <label className="seg-opt">
          <input
            type="radio"
            name="settingsSection"
            checked={settingsSection === 'priceSync'}
            readOnly
            onClick={() => setSettingsSection('priceSync')}
          />
          Price Sync
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

      {/* Price Sync section */}
      {settingsSection === 'priceSync' && (
      <section className="card blueprint elev-sm" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>Price Sync</div>
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
        {(() => {
          const notFoundSet = new Set(priceSync.lastRun?.notFound ?? [])
          const barsByTicker = new Map(allBars.map((b) => [b.ticker, b]))
          const symbols = Array.from(new Set([
            ...Object.keys(priceSync.heldPrices),
            ...(priceSync.lastRun?.notFound ?? []),
            ...allBars.map((b) => b.ticker),
          ])).sort((a, b) => a.localeCompare(b))

          if (symbols.length === 0) {
            return <p>No prices fetched yet.</p>
          }

          const rows = symbols.map((symbol) => {
            const held = priceSync.heldPrices[symbol]
            const bar = barsByTicker.get(symbol)
            const isHeld = symbol in priceSync.heldPrices || notFoundSet.has(symbol)
            const status = notFoundSet.has(symbol) ? 'Not found' : isHeld ? 'OK' : 'Market'
            const price = held?.price ?? bar?.close
            const tradingDate = held?.date ?? bar?.date
            return {
              symbol,
              status,
              held: isHeld ? 'Yes' : 'No',
              price: price !== undefined ? fmtUSD(price) : '—',
              tradingDate: tradingDate
                ? new Date(tradingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : '—',
              fetchedAt: held ? new Date(held.fetchedAt).toLocaleString() : '—',
            }
          })

          const q = priceSyncSearch.trim().toLowerCase()
          const filteredRows = q
            ? rows.filter(
                (r) =>
                  r.symbol.toLowerCase().includes(q) ||
                  r.status.toLowerCase().includes(q) ||
                  r.held.toLowerCase().includes(q)
              )
            : rows

          return (
            <>
              <div className="field" style={{ marginTop: 'var(--space-4)' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Search ticker or status..."
                  value={priceSyncSearch}
                  onChange={(e) => setPriceSyncSearch(e.target.value)}
                />
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 480px)', marginTop: 'var(--space-3)' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Price</th>
                      <th>Status</th>
                      <th>Held</th>
                      <th>Trading Date</th>
                      <th>Fetched At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r) => (
                      <tr key={r.symbol}>
                        <td>{r.symbol}</td>
                        <td>{r.price}</td>
                        <td style={r.status === 'Not found' ? { color: '#8a3c2e' } : undefined}>{r.status}</td>
                        <td>{r.held}</td>
                        <td>{r.tradingDate}</td>
                        <td>{r.fetchedAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        })()}
      </section>
      )}
    </div>
  )
}
