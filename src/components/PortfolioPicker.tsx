import { useRef, useState, type ChangeEvent } from 'react'
import type { Portfolio } from '../lib/types'
import type { EncryptedEnvelope } from '../lib/crypto'
import { nameKey } from '../lib/portfolioRegistry'
import { parseImportFile, ImportMalformedFileError, ImportDecryptError } from '../lib/importExport'
import { DriveDecryptError, DriveMalformedBackupError } from '../lib/drive'

export interface PortfolioPickerProps {
  portfolios: Portfolio[]
  onCreateNew: (name: string, password: string) => Promise<void>
  onRename: (id: string, newName: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onOpen: (id: string) => void
  onImportFromDriveFolder: (folder: { name: string; id: string }, password: string) => Promise<void>
  onImportFromFile: (envelope: EncryptedEnvelope, name: string, password: string) => Promise<void>
  onListDriveFolders: () => Promise<{ name: string; id: string }[]>
  isOnline: boolean
}

/**
 * PortfolioPicker: lists existing portfolios (rename inline, delete, open) and
 * a create-new-portfolio form below. Layout mirrors notesdiary's ProjectPicker
 * (centered column, list section + create section, meta line, text-link
 * delete) but uses this app's own design-system classes (card/btn/input).
 */
interface DriveRowState {
  password: string
  error: string | null
  importing: boolean
  passwordOpen: boolean
}

export function PortfolioPicker({
  portfolios,
  onCreateNew,
  onRename,
  onDelete,
  onOpen,
  onImportFromDriveFolder,
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
  const [driveFolders, setDriveFolders] = useState<{ name: string; id: string }[] | null>(null)
  const [driveListError, setDriveListError] = useState<string | null>(null)
  const [driveListLoading, setDriveListLoading] = useState(false)
  const [driveEmptyMessage, setDriveEmptyMessage] = useState<string | null>(null)
  const [driveRowState, setDriveRowState] = useState<Record<string, DriveRowState>>({})

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
      let message = 'Could not import this portfolio.'
      if (err instanceof DriveDecryptError) {
        message = 'Incorrect password.'
      } else if (err instanceof DriveMalformedBackupError) {
        message = 'Could not import this portfolio.'
      } else if (err instanceof Error) {
        message = err.message
      }
      setDriveRowState((prev) => ({
        ...prev,
        [folder.id]: { ...(prev[folder.id] ?? { passwordOpen: true }), password: '', error: message, importing: false, passwordOpen: true },
      }))
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minHeight: '100%',
        padding: 'var(--space-8) var(--space-6) var(--space-6)',
        gap: 'var(--space-8)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 480, minWidth: 0 }}>
        <h2 className="card-title" style={{ fontSize: 24, marginBottom: 'var(--space-4)' }}>
          Your Portfolios
        </h2>

        {portfolios.length === 0 ? (
          <p className="card-body" style={{ fontStyle: 'italic' }}>
            No portfolios yet. Create one below to get started.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {portfolios.map((portfolio) => (
              <div key={portfolio.id} className="card blueprint elev-sm">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
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
                        {portfolio.name}
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

                  <div style={{ flexShrink: 0 }}>
                    <button type="button" className="btn btn-primary" onClick={() => onOpen(portfolio.id)}>
                      Open
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 'var(--space-4)' }}>
          <button
            type="button"
            className="btn-ghost"
            style={{ border: 'none', background: 'none', cursor: isOnline ? 'pointer' : 'not-allowed' }}
            disabled={!isOnline || driveListLoading}
            title={isOnline ? undefined : 'Connect to the internet to import from Google Drive'}
            onClick={() => void handleOpenDriveFolders()}
          >
            {driveListLoading ? 'Loading Google Drive...' : 'Load from Google Drive'}
          </button>

          {driveListError && (
            <div className="tag tag-outline" style={{ marginTop: 'var(--space-2)' }}>
              {driveListError}{' '}
              <button
                type="button"
                className="btn-ghost"
                style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                onClick={dismissDriveListError}
              >
                Dismiss
              </button>
            </div>
          )}

          {driveFoldersOpen && !driveListError && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              {driveEmptyMessage && (
                <p className="card-body" style={{ fontStyle: 'italic' }}>
                  {driveEmptyMessage}
                </p>
              )}

              {driveFolders?.map((folder) => {
                const row = driveRowState[folder.id]
                return (
                  <div key={folder.id} className="card blueprint elev-sm">
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
      </div>

      <div style={{ width: '100%', maxWidth: 480, paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-divider)' }}>
        <h2 className="card-title" style={{ fontSize: 18, marginBottom: 'var(--space-4)' }}>
          Create New Portfolio
        </h2>

        <div className="field">
          <input
            className="input"
            placeholder="Enter a portfolio name"
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

        <div style={{ marginBottom: 'var(--space-3)' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => void handleFileInputChange(e)}
          />
          <button
            type="button"
            className="btn-ghost"
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
            disabled={creatingPasswordOpen}
            onClick={triggerFileInput}
          >
            Import from file
          </button>

          {fileImportError && !fileImportEnvelope && (
            <div className="tag tag-outline" style={{ marginTop: 'var(--space-2)' }}>
              {fileImportError}
            </div>
          )}
        </div>

        {error && (
          <div className="tag tag-outline" style={{ marginBottom: 'var(--space-2)' }}>
            {error}
          </div>
        )}

        {!creatingPasswordOpen ? (
          <button type="button" className="btn btn-primary" onClick={handleCreate}>
            Create
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
            <div className="field">
              <label>New password</label>
              <input
                className="input"
                type="password"
                placeholder="Enter a new password"
                value={newPassword}
                autoFocus
                autoComplete="new-password"
                onChange={(e) => {
                  setNewPassword(e.target.value)
                  setCreateError(null)
                }}
              />
            </div>
            <div className="field">
              <label>Confirm password</label>
              <input
                className="input"
                type="password"
                placeholder="Re-enter your password"
                value={newConfirm}
                autoComplete="new-password"
                onChange={(e) => {
                  setNewConfirm(e.target.value)
                  setCreateError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleSubmitCreate()
                  }
                }}
              />
            </div>

            {createError && (
              <div className="tag tag-outline" style={{ marginBottom: 0 }}>
                {createError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={creating}
                onClick={() => void handleSubmitCreate()}
              >
                {creating ? 'Creating...' : 'Set password & create'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                style={{ border: 'none', background: 'none', cursor: 'pointer' }}
                disabled={creating}
                onClick={cancelCreatePassword}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {fileImportEnvelope && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
            <div className="field">
              <label>Portfolio name</label>
              <input
                className="input"
                value={fileImportName}
                disabled={fileImporting}
                onChange={(e) => {
                  setFileImportName(e.target.value)
                  setFileImportError(null)
                }}
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                className="input"
                type="password"
                placeholder="Enter the backup's password"
                value={fileImportPassword}
                autoFocus
                autoComplete="current-password"
                disabled={fileImporting}
                onChange={(e) => {
                  setFileImportPassword(e.target.value)
                  setFileImportError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleSubmitFileImport()
                  }
                }}
              />
            </div>

            {fileImportError && (
              <div className="tag tag-outline" style={{ marginBottom: 0 }}>
                {fileImportError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={fileImporting}
                onClick={() => void handleSubmitFileImport()}
              >
                {fileImporting ? 'Importing...' : 'Import'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                style={{ border: 'none', background: 'none', cursor: 'pointer' }}
                disabled={fileImporting}
                onClick={cancelFileImport}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
