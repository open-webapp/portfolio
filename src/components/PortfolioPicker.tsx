import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { Portfolio } from '../lib/types'
import type { EncryptedEnvelope } from '../lib/crypto'
import { nameKey } from '../lib/portfolioRegistry'
import {
  downloadJsonAsFile,
  parseCategoryMappingImportFile,
  parseImportFile,
  ImportMalformedFileError,
  ImportDecryptError,
} from '../lib/importExport'
import { drive, DriveDecryptError, DriveMalformedBackupError, getPickerDriveAuth } from '../lib/drive'
import { pullGlobalCategoriesFromDrive } from '../lib/categoryDrive'
import {
  getSharedCategoryDriveFileId,
  loadGlobalCategoryState,
  saveGlobalCategoryState,
  setSharedCategoryDriveFileId,
} from '../lib/categoryPersist'
import { mergeCategoryState } from '../lib/categoryMerge'
import { navigateToCategories } from '../lib/router'
import { SharedSourceBadge, UnlinkButton } from './SharedSource'

export interface PortfolioPickerProps {
  portfolios: Portfolio[]
  onCreateNew: (name: string, password: string) => Promise<void>
  onRename: (id: string, newName: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onOpen: (id: string) => void
  onImportFromDriveFolder: (folder: { name: string; id: string }, password: string) => Promise<void>
  onImportSharedPortfolio: (folder: { name: string; id: string }, password: string) => Promise<void>
  onImportFromFile: (envelope: EncryptedEnvelope, name: string, password: string) => Promise<void>
  onListDriveFolders: () => Promise<{ name: string; id: string }[]>
  isOnline: boolean
}

/**
 * PortfolioPicker: lists existing portfolios (rename inline, delete, open),
 * creates/imports portfolios, and manages global category-mapping import/export.
 * Uses this app's design-system classes (card/btn/input).
 */
interface DriveRowState {
  password: string
  error: string | null
  importing: boolean
  passwordOpen: boolean
}

type PickerMode = 'open' | 'create' | 'drive' | 'settings'

function driveImportErrorMessage(err: unknown): string {
  if (err instanceof DriveDecryptError) return 'Incorrect password.'
  if (err instanceof DriveMalformedBackupError) return 'Could not import this portfolio.'
  return err instanceof Error ? err.message : 'Could not import this portfolio.'
}

export function PortfolioPicker({
  portfolios,
  onCreateNew,
  onRename,
  onDelete,
  onOpen,
  onImportFromDriveFolder,
  onImportSharedPortfolio,
  onImportFromFile,
  onListDriveFolders,
  isOnline,
}: PortfolioPickerProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [createDraft, setCreateDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [creatingPasswordOpen, setCreatingPasswordOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [newConfirm, setNewConfirm] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [fileImportEnvelope, setFileImportEnvelope] = useState<EncryptedEnvelope | null>(null)
  const [fileImportName, setFileImportName] = useState('')
  const [fileImportPassword, setFileImportPassword] = useState('')
  const [fileImportError, setFileImportError] = useState<string | null>(null)
  const [fileImporting, setFileImporting] = useState(false)

  const [driveFoldersOpen, setDriveFoldersOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState<PickerMode>('open')
  const [driveFolders, setDriveFolders] = useState<{ name: string; id: string }[] | null>(null)
  const [driveListError, setDriveListError] = useState<string | null>(null)
  const [driveListLoading, setDriveListLoading] = useState(false)
  const [driveEmptyMessage, setDriveEmptyMessage] = useState<string | null>(null)
  const [driveRowState, setDriveRowState] = useState<Record<string, DriveRowState>>({})
  const [sharedImportFolder, setSharedImportFolder] = useState<{ name: string; id: string } | null>(null)
  const [sharedImportState, setSharedImportState] = useState<DriveRowState | null>(null)

  const [globalCategoryState, setGlobalCategoryState] = useState<Awaited<ReturnType<typeof loadGlobalCategoryState>>>({
    categories: [],
    budgetAccountRules: [],
  })
  const [categoryMappingImportError, setCategoryMappingImportError] = useState<string | null>(null)
  const categoryMappingInputRef = useRef<HTMLInputElement | null>(null)
  const [sharedCategoryDriveFileId, setSharedCategoryDriveFileIdState] = useState<string | undefined>(undefined)

  useEffect(() => {
    void loadGlobalCategoryState().then(setGlobalCategoryState)
    void getSharedCategoryDriveFileId().then(setSharedCategoryDriveFileIdState)
  }, [])

  const startRename = (portfolio: Portfolio) => {
    setRenamingId(portfolio.id)
    setRenameDraft(portfolio.name)
  }

  const commitRename = async (portfolio: Portfolio) => {
    const trimmed = renameDraft.trim()
    setRenamingId(null)
    if (!trimmed || trimmed.toLowerCase() === portfolio.name.trim().toLowerCase()) {
      return
    }
    await onRename(portfolio.id, trimmed)
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameDraft('')
  }

  const handleDownloadCategoryMapping = () => {
    downloadJsonAsFile(
      {
        categories: globalCategoryState.categories,
        budgetAccountRules: globalCategoryState.budgetAccountRules,
      },
      'category-mapping.json',
    )
  }

  const handleCategoryMappingImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const imported = parseCategoryMappingImportFile(await file.text())
      const merged = mergeCategoryState(globalCategoryState, imported)
      await saveGlobalCategoryState(merged)
      // The picker has no portfolio transactions to reapply; opening a portfolio hydrates its mappings.
      setGlobalCategoryState(merged)
      setCategoryMappingImportError(null)
    } catch {
      setCategoryMappingImportError('This is not a valid category mapping file.')
    } finally {
      e.target.value = ''
    }
  }

  const handleSharedCategoryMappingDriveImport = async () => {
    try {
      const pickedFile = await drive.project('picker').pickFile({
        unscoped: true,
        mimeTypes: ['application/json'],
        multiSelect: false,
      })
      if (!pickedFile) return

      const remote = await pullGlobalCategoriesFromDrive(getPickerDriveAuth(), 'picker', pickedFile.id)
      if (!remote) {
        setCategoryMappingImportError('This is not a valid shared category mapping file.')
        return
      }

      const merged = mergeCategoryState(globalCategoryState, remote)
      await saveGlobalCategoryState(merged)
      await setSharedCategoryDriveFileId(pickedFile.id)
      setGlobalCategoryState(merged)
      setCategoryMappingImportError(null)
    } catch {
      setCategoryMappingImportError('Could not import the shared category mapping from Google Drive.')
    }
  }

  const handleUnlinkSharedCategoryMapping = async () => {
    try {
      await setSharedCategoryDriveFileId(null)
      setSharedCategoryDriveFileIdState(undefined)
      setCategoryMappingImportError(null)
    } catch {
      setCategoryMappingImportError('Could not unlink the shared category mapping.')
    }
  }

  const handleDelete = async (portfolio: Portfolio) => {
    const confirmed = window.confirm(`Delete portfolio "${portfolio.name}"? This cannot be undone.`)
    if (!confirmed) return
    await onDelete(portfolio.id)
  }

  const handleCreate = () => {
    const name = createDraft.trim()
    if (!name) return
    setError(null)
    setCreateError(null)
    setCreatingPasswordOpen(true)
  }

  const cancelCreatePassword = () => {
    setCreatingPasswordOpen(false)
    setNewPassword('')
    setNewConfirm('')
    setCreateError(null)
  }

  const handleSubmitCreate = async () => {
    const name = createDraft.trim()
    if (!name) return
    setCreateError(null)

    if (newPassword.length < 6) {
      setCreateError('Password must be at least 6 characters')
      return
    }
    if (newPassword !== newConfirm) {
      setCreateError('Passwords do not match')
      return
    }

    setCreating(true)
    try {
      await onCreateNew(name, newPassword)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'A portfolio with this name already exists.')
      setNewPassword('')
      setNewConfirm('')
      setCreating(false)
    }
  }

  // --- File import ---

  const resetFileImport = () => {
    setFileImportEnvelope(null)
    setFileImportName('')
    setFileImportPassword('')
    setFileImportError(null)
    setFileImporting(false)
  }

  const handleFileInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const envelope = parseImportFile(text)
      const nameWithoutExt = file.name.replace(/\.[^./\\]+$/, '')
      setFileImportEnvelope(envelope)
      setFileImportName(nameWithoutExt)
      setFileImportPassword('')
      setFileImportError(null)
    } catch (err) {
      resetFileImport()
      if (err instanceof ImportMalformedFileError) {
        setFileImportError('This is not a valid backup file.')
      } else {
        setFileImportError(err instanceof Error ? err.message : 'Could not read the selected file.')
      }
    }
  }

  const triggerFileInput = () => {
    fileInputRef.current?.click()
  }

  const cancelFileImport = () => {
    resetFileImport()
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleSubmitFileImport = async () => {
    if (!fileImportEnvelope) return
    const name = fileImportName.trim()
    if (!name) return

    setFileImportError(null)
    setFileImporting(true)
    try {
      await onImportFromFile(fileImportEnvelope, name, fileImportPassword)
      resetFileImport()
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (err) {
      if (err instanceof ImportDecryptError) {
        setFileImportError('Incorrect password.')
      } else {
        setFileImportError(err instanceof Error ? err.message : 'Could not import this file.')
      }
      setFileImportPassword('')
      setFileImporting(false)
    }
  }

  // --- Drive folder import ---

  const handleOpenDriveFolders = async () => {
    setDriveListLoading(true)
    setDriveListError(null)
    setDriveEmptyMessage(null)
    try {
      const raw = await onListDriveFolders()
      const localNameKeys = new Set(portfolios.map((p) => nameKey(p.name)))
      const filtered = raw.filter((folder) => !localNameKeys.has(nameKey(folder.name)))

      if (raw.length === 0) {
        setDriveEmptyMessage('No portfolios found in Google Drive.')
      } else if (filtered.length === 0) {
        setDriveEmptyMessage('All Google Drive portfolios are already in Your Portfolios.')
      } else {
        setDriveEmptyMessage(null)
      }

      setDriveFolders(filtered)
      setDriveFoldersOpen(true)
    } catch {
      setDriveListError("Couldn't connect to Google Drive.")
      setDriveFolders(null)
      setDriveFoldersOpen(true)
    } finally {
      setDriveListLoading(false)
    }
  }

  const dismissDriveListError = () => {
    setDriveListError(null)
    setDriveFoldersOpen(false)
  }

  const toggleDriveRowPassword = (folderId: string) => {
    setDriveRowState((prev) => {
      const current = prev[folderId] ?? { password: '', error: null, importing: false, passwordOpen: false }
      return {
        ...prev,
        [folderId]: { ...current, passwordOpen: !current.passwordOpen, error: null },
      }
    })
  }

  const setDriveRowPassword = (folderId: string, password: string) => {
    setDriveRowState((prev) => {
      const current = prev[folderId] ?? { password: '', error: null, importing: false, passwordOpen: true }
      return { ...prev, [folderId]: { ...current, password, error: null } }
    })
  }

  const handleSubmitDriveImport = async (folder: { name: string; id: string }) => {
    const row = driveRowState[folder.id]
    const password = row?.password ?? ''

    setDriveRowState((prev) => ({
      ...prev,
      [folder.id]: { ...(prev[folder.id] ?? { password: '', error: null, passwordOpen: true }), importing: true, error: null },
    }))

    try {
      await onImportFromDriveFolder(folder, password)
    } catch (err) {
      const message = driveImportErrorMessage(err)
      setDriveRowState((prev) => ({
        ...prev,
        [folder.id]: { ...(prev[folder.id] ?? { passwordOpen: true }), password: '', error: message, importing: false, passwordOpen: true },
      }))
    }
  }

  const handlePickSharedPortfolio = async () => {
    const folder = await drive.project('picker').pickFile({ unscoped: true, includeFolders: true, multiSelect: false })
    if (!folder) return
    setSharedImportFolder({ name: folder.name, id: folder.id })
    setSharedImportState({ password: '', error: null, importing: false, passwordOpen: true })
  }

  const handleSubmitSharedImport = async () => {
    if (!sharedImportFolder || !sharedImportState) return

    setSharedImportState({ ...sharedImportState, importing: true, error: null })
    try {
      await onImportSharedPortfolio(sharedImportFolder, sharedImportState.password)
      setSharedImportFolder(null)
      setSharedImportState(null)
    } catch (err) {
      setSharedImportState({ ...sharedImportState, password: '', error: driveImportErrorMessage(err), importing: false })
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minHeight: '100%',
        padding: '64px var(--space-4)',
        gap: 'var(--space-6)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 520, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="eyebrow">Ledger</div>
          <h1 className="card-title" style={{ fontSize: 24, margin: 'var(--space-2) 0 0' }}>
            Your portfolios
          </h1>
        </div>

        <div className="seg" style={{ display: 'flex', width: '100%' }}>
          {([
            ['open', 'Open'],
            ['create', 'Create'],
            ['drive', 'Google Drive'],
          ] as const).map(([mode, label]) => (
            <label key={mode} className="seg-opt" style={{ flex: 1, justifyContent: 'center' }}>
              <input type="radio" name="portfolioPickerMode" checked={pickerMode === mode} onChange={() => setPickerMode(mode)} />
              <span>{label}</span>
            </label>
          ))}
          <label className="seg-opt" style={{ flex: '0 0 48px', justifyContent: 'flex-end' }} title="Settings">
            <input type="radio" name="portfolioPickerMode" aria-label="Settings" checked={pickerMode === 'settings'} onChange={() => setPickerMode('settings')} />
            <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56V20.3h-3v-.08A1.7 1.7 0 0 0 10.66 18.66a1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 15a1.7 1.7 0 0 0-1.56-1.04h-.08v-3h.08A1.7 1.7 0 0 0 7 9.92a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.7 4.7v-.08h3v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.04h.08v3h-.08A1.7 1.7 0 0 0 19.4 15Z" />
            </svg>
          </label>
        </div>

        {pickerMode === 'open' && (
          <div className="card blueprint elev-sm" style={{ display: 'flex', flexDirection: 'column' }}>
            {portfolios.length === 0 ? (
              <p className="card-body" style={{ fontStyle: 'italic', margin: 'var(--space-2) 0' }}>
                No portfolios yet. Create one to get started.
              </p>
            ) : (
              portfolios.map((portfolio, index) => (
                <div key={portfolio.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) 0', borderTop: index === 0 ? 'none' : '1px solid var(--color-divider)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {renamingId === portfolio.id ? (
                      <input
                        className="input"
                        value={renameDraft}
                        autoFocus
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => void commitRename(portfolio)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void commitRename(portfolio)
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelRename()
                          }
                        }}
                      />
                    ) : (
                      <div className="card-title" onClick={() => startRename(portfolio)} style={{ cursor: 'pointer' }}>
                        {portfolio.name} {portfolio.sharedDriveFolderId && <SharedSourceBadge />}
                      </div>
                    )}
                    <p className="card-body" style={{ fontSize: 12, margin: 'var(--space-1) 0 0' }}>
                      Created {new Date(portfolio.createdAt).toLocaleDateString()}
                    </p>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{
                        border: 'none',
                        background: 'none',
                        padding: 0,
                        marginTop: 'var(--space-1)',
                        fontSize: 12,
                        display: 'block',
                        cursor: 'pointer',
                      }}
                      onClick={() => void handleDelete(portfolio)}
                      title={`Delete ${portfolio.name}`}
                    >
                      Delete
                    </button>
                  </div>
                  <button type="button" className="btn btn-primary" onClick={() => onOpen(portfolio.id)}>
                    Open
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {pickerMode === 'create' && (
          <div className="card blueprint elev-sm" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="field">
              <label>Portfolio name</label>
              <input
                className="input"
                placeholder="e.g. Retirement"
                value={createDraft}
                disabled={creatingPasswordOpen}
                onChange={(e) => {
                  setCreateDraft(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !creatingPasswordOpen) {
                    e.preventDefault()
                    handleCreate()
                  }
                }}
              />
              </div>

            {error && <div className="tag tag-outline">{error}</div>}

            {!creatingPasswordOpen ? (
              <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-end' }} onClick={handleCreate}>
                Create
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div className="field">
                  <label>New password</label>
                  <input className="input" type="password" placeholder="Enter a new password" value={newPassword} autoFocus autoComplete="new-password" onChange={(e) => { setNewPassword(e.target.value); setCreateError(null) }} />
                </div>
                <div className="field">
                  <label>Confirm password</label>
                  <input className="input" type="password" placeholder="Re-enter your password" value={newConfirm} autoComplete="new-password" onChange={(e) => { setNewConfirm(e.target.value); setCreateError(null) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleSubmitCreate() } }} />
                </div>
                {createError && <div className="tag tag-outline" style={{ marginBottom: 0 }}>{createError}</div>}
                <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn-ghost" style={{ border: 'none', background: 'none', cursor: 'pointer' }} disabled={creating} onClick={cancelCreatePassword}>Cancel</button>
                  <button type="button" className="btn btn-primary" disabled={creating} onClick={() => void handleSubmitCreate()}>{creating ? 'Creating...' : 'Set password & create'}</button>
                </div>
              </div>
            )}

            <div className="hr" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className="card-body">Already have a backup file?</div>
              <input ref={fileInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => void handleFileInputChange(e)} />
              <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} disabled={creatingPasswordOpen} onClick={triggerFileInput}>Import from file</button>
              {fileImportError && !fileImportEnvelope && <div className="tag tag-outline">{fileImportError}</div>}
              {fileImportEnvelope && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <div className="field"><label>Portfolio name</label><input className="input" value={fileImportName} disabled={fileImporting} onChange={(e) => { setFileImportName(e.target.value); setFileImportError(null) }} /></div>
                  <div className="field"><label>Password</label><input className="input" type="password" placeholder="Enter the backup's password" value={fileImportPassword} autoFocus autoComplete="current-password" disabled={fileImporting} onChange={(e) => { setFileImportPassword(e.target.value); setFileImportError(null) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleSubmitFileImport() } }} /></div>
                  {fileImportError && <div className="tag tag-outline" style={{ marginBottom: 0 }}>{fileImportError}</div>}
                  <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}><button type="button" className="btn-ghost" style={{ border: 'none', background: 'none', cursor: 'pointer' }} disabled={fileImporting} onClick={cancelFileImport}>Cancel</button><button type="button" className="btn btn-primary" disabled={fileImporting} onClick={() => void handleSubmitFileImport()}>{fileImporting ? 'Importing...' : 'Import'}</button></div>
                </div>
              )}
            </div>
          </div>
        )}

        {pickerMode === 'drive' && (
          <div className="card blueprint elev-sm" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className="card-title">My portfolios</div>
              {!driveFoldersOpen && <><div className="card-body">Restore a portfolio you've backed up to Google Drive.</div><button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={!isOnline || driveListLoading} title={isOnline ? undefined : 'Connect to the internet to import from Google Drive'} onClick={() => void handleOpenDriveFolders()}>{driveListLoading ? 'Loading Google Drive...' : 'Load from Google Drive'}</button></>}
              {driveListError && <div className="tag tag-outline">{driveListError} <button type="button" className="btn-ghost" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} onClick={dismissDriveListError}>Dismiss</button></div>}
              {driveFoldersOpen && !driveListError && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {driveEmptyMessage && (
                <p className="card-body" style={{ fontStyle: 'italic' }}>
                  {driveEmptyMessage}
                </p>
              )}

              {driveFolders?.map((folder) => {
                const row = driveRowState[folder.id]
                return (
                  <div key={folder.id} style={{ padding: 'var(--space-3) 0', borderTop: '1px solid var(--color-divider)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                      <div className="card-title" style={{ flex: 1, minWidth: 0 }}>
                        {folder.name}
                      </div>
                      {!row?.passwordOpen && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => toggleDriveRowPassword(folder.id)}
                        >
                          Import
                        </button>
                      )}
                    </div>

                    {row?.passwordOpen && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                        <div className="field">
                          <label>Password</label>
                          <input
                            className="input"
                            type="password"
                            placeholder="Enter the portfolio's password"
                            value={row.password}
                            autoFocus
                            autoComplete="current-password"
                            disabled={row.importing}
                            onChange={(e) => setDriveRowPassword(folder.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                void handleSubmitDriveImport(folder)
                              }
                            }}
                          />
                        </div>

                        {row.error && (
                          <div className="tag tag-outline" style={{ marginBottom: 0 }}>
                            {row.error}
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={row.importing}
                            onClick={() => void handleSubmitDriveImport(folder)}
                          >
                            {row.importing ? 'Importing...' : 'Import'}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ border: 'none', background: 'none', cursor: 'pointer' }}
                            disabled={row.importing}
                            onClick={() => toggleDriveRowPassword(folder.id)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
                </div>
              )}
            </div>
            <div className="hr" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className="card-title">Shared portfolio</div>
              {!sharedImportFolder && <><div className="card-body">Open a portfolio someone else shared with you on Google Drive.</div><button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => void handlePickSharedPortfolio()}>Import a shared portfolio</button></>}
              {sharedImportFolder && sharedImportState && <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}><div className="card-title">{sharedImportFolder.name}</div><div className="field"><label>Password</label><input className="input" type="password" placeholder="Enter the portfolio's password" value={sharedImportState.password} autoFocus autoComplete="current-password" disabled={sharedImportState.importing} onChange={(e) => setSharedImportState({ ...sharedImportState, password: e.target.value, error: null })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleSubmitSharedImport() } }} /></div>{sharedImportState.error && <div className="tag tag-outline" style={{ marginBottom: 0 }}>{sharedImportState.error}</div>}<div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}><button type="button" className="btn-ghost" style={{ border: 'none', background: 'none', cursor: 'pointer' }} disabled={sharedImportState.importing} onClick={() => { setSharedImportFolder(null); setSharedImportState(null) }}>Cancel</button><button type="button" className="btn btn-primary" disabled={sharedImportState.importing} onClick={() => void handleSubmitSharedImport()}>{sharedImportState.importing ? 'Importing...' : 'Import'}</button></div></div>}
            </div>
          </div>
        )}

        {pickerMode === 'settings' && (
          <div className="card blueprint elev-sm" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <h2 className="card-title" style={{ fontSize: 18, margin: 0 }}>
                Settings — Budget Categories
              </h2>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
                <button type="button" className="btn btn-secondary btn-icon" aria-label="Import mapping file" title="Import mapping file" onClick={() => categoryMappingInputRef.current?.click()}>
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5M12 3v12" /></svg>
                </button>
                <button type="button" className="btn btn-secondary btn-icon" aria-label="Download mapping file" title="Download mapping file" disabled={globalCategoryState.categories.length === 0 && globalCategoryState.budgetAccountRules.length === 0} onClick={handleDownloadCategoryMapping}>
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></svg>
                </button>
              </div>
            </div>
            <div className="card-body">Applies the same asset-class categories and account mappings across every portfolio on this device. Loading a portfolio from Google Drive loads its mapping too.</div>
            <input
              ref={categoryMappingInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => void handleCategoryMappingImport(e)}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
              <div className="card-body">{globalCategoryState.categories.length} categories · {globalCategoryState.budgetAccountRules.length} budget account rules</div>
              <button type="button" className="btn btn-primary" onClick={navigateToCategories}>Manage</button>
            </div>
            <div className="hr" />
            <div className="card-body">Open the mapping someone else shared with you directly or via Google Drive.</div>
            {!sharedCategoryDriveFileId && <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => void handleSharedCategoryMappingDriveImport()}>Import a shared mapping from Google Drive</button>}
            {sharedCategoryDriveFileId && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}><SharedSourceBadge /><UnlinkButton confirmText="Unlink this shared category mapping?" onUnlink={handleUnlinkSharedCategoryMapping} /></div>}
            {categoryMappingImportError && <div className="tag tag-outline">{categoryMappingImportError}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
