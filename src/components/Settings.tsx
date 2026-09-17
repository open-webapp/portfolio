import { useCallback, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AppState } from '../lib/state'
import type { Portfolio, Category, CategoryMapping } from '../lib/types'
import type { CategoryAction } from '../lib/categoryStore'
import { GoogleDriveWidget } from '@open-webapp/drive-connect'
import type { DriveAuthHandle } from '@open-webapp/drive-connect'
import { syncBackup, getConnectionSnapshot } from '../lib/drive'
import { deriveKey, generateSalt } from '../lib/crypto'
import { loadPersistedApp, savePersistedApp } from '../lib/persist'
import {
  exportBackup,
  downloadEnvelopeAsFile,
  downloadJsonAsFile,
  parseCategoryMappingImportFile,
  CategoryMappingImportError,
} from '../lib/importExport'
import { referencedCategories, mappingsForCategory } from '../lib/selectors'

const iconBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  padding: '4px',
  display: 'inline-flex',
  alignItems: 'center',
}

const textBtnAccent: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: 'var(--color-accent)',
  fontSize: '12px',
  fontWeight: 600,
  padding: 0,
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path>
    </svg>
  )
}

export interface SettingsPageProps {
  state: AppState
  dispatch: (action: any) => void
  activePortfolio: Portfolio
  driveAuth: DriveAuthHandle
  sessionKey: CryptoKey
  sessionSalt: Uint8Array
  onKeyChange: (newKey: CryptoKey, newSalt: Uint8Array) => void
  onPasswordEntryTimeReset: () => void
  onDriveConnected: (connection: unknown) => void
  onDriveDisconnected: () => void
  settingsSection: 'backup' | 'encryption' | 'priceSync' | 'categories'
  setSettingsSection: (s: 'backup' | 'encryption' | 'priceSync' | 'categories') => void
  runPriceSyncTrigger: (overrideDate?: string) => Promise<void>
  runMutualFundSyncTrigger: () => Promise<void>
  tickerOverviewErrors: Record<string, string>
  mutualFundSyncErrors: Record<string, string>
  categories: Category[]
  categoryMappings: CategoryMapping[]
  categoryDispatch: (action: CategoryAction) => void
  categoriesHydrated: boolean
}

/**
 * SettingsPage: Full-page settings view with Drive sync options.
 */
export function SettingsPage({
  state,
  dispatch,
  activePortfolio,
  driveAuth,
  sessionKey,
  sessionSalt,
  onKeyChange,
  onPasswordEntryTimeReset,
  onDriveConnected,
  onDriveDisconnected,
  settingsSection,
  setSettingsSection,
  runPriceSyncTrigger,
  runMutualFundSyncTrigger,
  tickerOverviewErrors,
  mutualFundSyncErrors,
  categories,
  categoryMappings,
  categoryDispatch,
  categoriesHydrated,
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

  // Categories local state
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [categoryNameDraft, setCategoryNameDraft] = useState('')
  const [newSubstringDraftByCategory, setNewSubstringDraftByCategory] = useState<Record<string, string>>({})
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null)
  const [mappingSubstringDraft, setMappingSubstringDraft] = useState('')
  const [reapplySuccess, setReapplySuccess] = useState<string | null>(null)

  // Category mapping import/export local state
  const categoryImportFileInputRef = useRef<HTMLInputElement>(null)
  const [categoryImportError, setCategoryImportError] = useState<string | null>(null)

  const handleReapplyMappings = useCallback(() => {
    dispatch({ type: 'REAPPLY_CATEGORY_MAPPINGS', categoryMappings })
    setReapplySuccess('Re-applied.')
    setTimeout(() => setReapplySuccess(null), 3000)
  }, [dispatch, categoryMappings])

  const handleCategoryImportFileSelect = useCallback(
    (file: File | null) => {
      setCategoryImportError(null)
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const imported = parseCategoryMappingImportFile(String(reader.result ?? ''))
          categoryDispatch({ type: '__MERGE_IMPORTED', imported })
        } catch (error) {
          if (error instanceof CategoryMappingImportError) {
            setCategoryImportError(error.message)
          } else {
            throw error
          }
        }
      }
      reader.readAsText(file)
    },
    [categoryDispatch]
  )

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
        if (getConnectionSnapshot(activePortfolio) !== null) {
          await syncBackup(activePortfolio, state, newKey, newSalt)
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
  }, [currentPasswordInput, newPasswordInput, confirmNewPasswordInput, sessionSalt, state, activePortfolio, onKeyChange, onPasswordEntryTimeReset])

  return (
    <div>
      {/* Settings tab-seg */}
      <div className="seg" style={{ marginBottom: 'var(--space-5)' }}>
        <label className="seg-opt">
          <input
            type="radio"
            name="settingsSection"
            checked={settingsSection === 'backup'}
            readOnly
            onClick={() => setSettingsSection('backup')}
          />
          Backup
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
        <label className="seg-opt">
          <input
            type="radio"
            name="settingsSection"
            checked={settingsSection === 'categories'}
            readOnly
            onClick={() => setSettingsSection('categories')}
          />
          Categories
        </label>
      </div>
      <div className="hr" style={{ marginBottom: 'var(--space-5)' }} />

      {/* Google Drive Sync section */}
      {settingsSection === 'backup' && (
      <section className="card blueprint elev-sm" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>Google Drive Sync</div>
        <GoogleDriveWidget
          auth={driveAuth}
          onConnected={onDriveConnected}
          onDisconnected={onDriveDisconnected}
        />
      </section>
      )}

      {/* Import/Export section */}
      {settingsSection === 'backup' && (
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
        {categoriesHydrated && (
          <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-color, #ddd)', display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <button
              className="btn btn-primary blueprint"
              onClick={() => {
                const now = new Date()
                const yyyy = now.getFullYear()
                const mm = String(now.getMonth() + 1).padStart(2, '0')
                const dd = String(now.getDate()).padStart(2, '0')
                downloadJsonAsFile({ categories, categoryMappings }, `category-mappings-${yyyy}-${mm}-${dd}.json`)
              }}
            >
              Download Category Mapping
            </button>
            <button
              className="btn btn-secondary blueprint"
              onClick={() => categoryImportFileInputRef.current?.click()}
            >
              Import Category Mapping
            </button>
            <input
              ref={categoryImportFileInputRef}
              type="file"
              accept="application/json"
              aria-label="Import Category Mapping file"
              style={{ display: 'none' }}
              onChange={(e) => {
                handleCategoryImportFileSelect(e.target.files?.[0] || null)
                e.target.value = ''
              }}
            />
          </div>
        )}
        {categoryImportError && (
          <p style={{ marginTop: 'var(--space-3)', marginBottom: 0, color: '#8a3c2e' }}>{categoryImportError}</p>
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

      {/* Categories section */}
      {settingsSection === 'categories' && (
      <section className="card blueprint elev-sm" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>Categories</div>
        {referencedCategories(categories, categoryMappings, Object.values(state.budgetExpensesByYear).flat(), state.budgetTransactions).map((category) => {
          const isEditingCategory = editingCategoryId === category.id
          const mappings = mappingsForCategory(categoryMappings, category.id)
          const newSubstringDraft = newSubstringDraftByCategory[category.id] ?? ''
          return (
            <div key={category.id} style={{ marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--border-color, #ddd)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {isEditingCategory ? (
                  <>
                    <input
                      className="input"
                      aria-label="Edit category name"
                      value={categoryNameDraft}
                      onChange={(e) => setCategoryNameDraft(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      style={textBtnAccent}
                      onClick={() => {
                        categoryDispatch({ type: 'RENAME_CATEGORY', id: category.id, name: categoryNameDraft.trim() })
                        setEditingCategoryId(null)
                      }}
                    >
                      Done
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ fontWeight: 600 }}>{category.name}</span>
                    <button
                      type="button"
                      style={{ ...iconBtn, color: 'var(--color-accent)' }}
                      aria-label={`Edit category ${category.name}`}
                      title="Edit category"
                      onClick={() => {
                        setEditingCategoryId(category.id)
                        setCategoryNameDraft(category.name)
                      }}
                    >
                      <PencilIcon />
                    </button>
                  </>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginLeft: 'var(--space-2)' }}>
                  <input
                    type="checkbox"
                    aria-label={`Exclude ${category.name} from spend tracking`}
                    checked={category.excludeFromSpend ?? false}
                    onChange={(e) =>
                      categoryDispatch({
                        type: 'SET_CATEGORY_EXCLUDE_FROM_SPEND',
                        id: category.id,
                        exclude: e.target.checked,
                      })
                    }
                  />
                  Exclude from spend tracking
                </label>
              </div>
              <div style={{ marginLeft: 'var(--space-5)', marginTop: 'var(--space-2)' }}>
                {mappings.map((mapping) => {
                  const isEditingMapping = editingMappingId === mapping.id
                  return (
                    <div key={mapping.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                      {isEditingMapping ? (
                        <>
                          <input
                            className="input"
                            aria-label="Edit mapping substring"
                            value={mappingSubstringDraft}
                            onChange={(e) => setMappingSubstringDraft(e.target.value)}
                            autoFocus
                          />
                          <button
                            type="button"
                            style={textBtnAccent}
                            onClick={() => {
                              categoryDispatch({
                                type: 'UPDATE_CATEGORY_MAPPING',
                                id: mapping.id,
                                patch: { substring: mappingSubstringDraft.trim() },
                              })
                              setEditingMappingId(null)
                            }}
                          >
                            Done
                          </button>
                        </>
                      ) : (
                        <>
                          <span>{mapping.substring}</span>
                          <button
                            type="button"
                            style={{ ...iconBtn, color: 'var(--color-accent)' }}
                            aria-label={`Edit substring ${mapping.substring}`}
                            title="Edit substring"
                            onClick={() => {
                              setEditingMappingId(mapping.id)
                              setMappingSubstringDraft(mapping.substring)
                            }}
                          >
                            <PencilIcon />
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                  <input
                    className="input"
                    placeholder="+ add substring"
                    aria-label={`Add substring to ${category.name}`}
                    value={newSubstringDraft}
                    onChange={(e) =>
                      setNewSubstringDraftByCategory((prev) => ({ ...prev, [category.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newSubstringDraft.trim()) {
                        categoryDispatch({ type: 'ADD_CATEGORY_MAPPING', categoryId: category.id, substring: newSubstringDraft.trim() })
                        setNewSubstringDraftByCategory((prev) => ({ ...prev, [category.id]: '' }))
                      }
                    }}
                  />
                  <button
                    type="button"
                    style={textBtnAccent}
                    aria-label={`Add substring button ${category.name}`}
                    disabled={!newSubstringDraft.trim()}
                    onClick={() => {
                      categoryDispatch({ type: 'ADD_CATEGORY_MAPPING', categoryId: category.id, substring: newSubstringDraft.trim() })
                      setNewSubstringDraftByCategory((prev) => ({ ...prev, [category.id]: '' }))
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )
        })}
        <button
          type="button"
          className="btn btn-secondary blueprint"
          onClick={handleReapplyMappings}
        >
          Re-apply mappings to existing records
        </button>
        {reapplySuccess && (
          <p style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>{reapplySuccess}</p>
        )}
      </section>
      )}
    </div>
  )
}
