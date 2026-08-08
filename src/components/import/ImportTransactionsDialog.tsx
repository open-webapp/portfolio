import { useCallback, useRef, useState } from 'react'
import type { AppState } from '../../lib/state'
import type { MappingProfile } from '../../lib/types'
import { parseCsvFile } from '../../lib/csv'
import { listProfilesForKind, applyMapping } from '../../lib/mappingProfiles'
import { MappingProfileEditor } from './MappingProfileEditor'

export interface ImportTransactionsDialogProps {
  state: AppState
  dispatch: (action: any) => void
}

type DialogStep = 'closed' | 'file-picker' | 'profile-select' | 'profile-editor' | 'review'

/**
 * ImportTransactionsDialog: Multi-step dialog for importing transactions from CSV.
 * 1. File picker
 * 2. Profile selection (or create new)
 * 3. Profile editor (if creating new)
 * 4. Review and apply mapping
 * 5. Hand off to Task 14 via pendingImport state
 */
export function ImportTransactionsDialog({ state, dispatch }: ImportTransactionsDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<DialogStep>('closed')
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([])
  const [selectedProfile, setSelectedProfile] = useState<MappingProfile | null>(null)
  const [editingProfile, setEditingProfile] = useState<MappingProfile | null>(null)

  const transactionsProfiles = listProfilesForKind(state.mappingProfiles, 'transactions')

  const handleOpenDialog = useCallback(() => {
    setStep('file-picker')
  }, [])

  const handleCloseDialog = useCallback(() => {
    setStep('closed')
    setCsvHeaders([])
    setCsvRows([])
    setSelectedProfile(null)
    setEditingProfile(null)
  }, [])

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        const parsed = await parseCsvFile(file)
        setCsvHeaders(parsed.headers)
        setCsvRows(parsed.rows)
        setStep('profile-select')
      } catch (error) {
        alert(`Error parsing CSV: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    []
  )

  const handleSelectExistingProfile = useCallback((profileId: string) => {
    const profile = transactionsProfiles.find((p) => p.id === profileId)
    if (profile) {
      setSelectedProfile(profile)
      setStep('review')
    }
  }, [transactionsProfiles])

  const handleCreateNewProfile = useCallback(() => {
    setEditingProfile(null)
    setStep('profile-editor')
  }, [])

  const handleProfileSave = useCallback(
    (profile: MappingProfile) => {
      // Dispatch action to add/update profile in state
      if (profile.id.startsWith('map-')) {
        // New profile
        dispatch({
          type: 'ADD_MAPPING_PROFILE',
          profile,
        })
      } else {
        // Updated profile
        dispatch({
          type: 'UPDATE_MAPPING_PROFILE',
          profileId: profile.id,
          profile,
        })
      }

      setSelectedProfile(profile)
      setStep('review')
    },
    [dispatch]
  )

  const handleProfileEditorCancel = useCallback(() => {
    setEditingProfile(null)
    setStep('profile-select')
  }, [])

  const handleApplyMapping = useCallback(() => {
    if (!selectedProfile || csvRows.length === 0) return

    // Apply mapping to all rows
    const mapped = csvRows.map((row) => applyMapping(row, selectedProfile))

    // Dispatch to set pending import
    dispatch({
      type: 'SET_PENDING_IMPORT',
      pendingImport: {
        kind: 'transactions',
        rows: mapped,
        profileId: selectedProfile.id,
      },
    })

    // Close dialog
    handleCloseDialog()
  }, [selectedProfile, csvRows, dispatch, handleCloseDialog])

  if (step === 'closed') {
    return (
      <button
        onClick={handleOpenDialog}
        style={{
          padding: '8px 16px',
          borderRadius: '4px',
          border: 'none',
          background: 'var(--color-accent)',
          color: 'var(--color-bg)',
          cursor: 'pointer',
        }}
      >
        Import Transactions
      </button>
    )
  }

  return (
    <>
      {/* Modal backdrop */}
      <div
        onClick={handleCloseDialog}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 999,
        }}
      />

      {/* Modal dialog */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-divider)',
          borderRadius: '8px',
          padding: 'var(--space-6)',
          maxWidth: '600px',
          maxHeight: '80vh',
          overflowY: 'auto',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        }}
      >
      {/* File Picker Step */}
      {step === 'file-picker' && (
        <div>
          <h2>Import Transactions</h2>
          <p>Select a CSV file with transaction data</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            style={{ marginBottom: 'var(--space-4)' }}
          />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              onClick={handleCloseDialog}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: '1px solid var(--color-divider)',
                background: 'var(--color-surface)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Profile Selection Step */}
      {step === 'profile-select' && (
        <div>
          <h2>Select Mapping Profile</h2>
          <p>Choose an existing profile or create a new one</p>

          {transactionsProfiles.length > 0 && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <strong>Existing Profiles:</strong>
              <div style={{ marginTop: '8px' }}>
                {transactionsProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    onClick={() => handleSelectExistingProfile(profile.id)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '8px 12px',
                      marginBottom: '6px',
                      textAlign: 'left',
                      border: '1px solid var(--color-divider)',
                      background: 'var(--color-bg)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    {profile.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 'var(--space-4)' }}>
            <button
              onClick={handleCreateNewProfile}
              style={{
                width: '100%',
                padding: '8px 16px',
                borderRadius: '4px',
                border: '1px dashed var(--color-divider)',
                background: 'var(--color-bg)',
                cursor: 'pointer',
              }}
            >
              Create New Profile
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              onClick={handleCloseDialog}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: '1px solid var(--color-divider)',
                background: 'var(--color-surface)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Profile Editor Step */}
      {step === 'profile-editor' && (
        <div>
          <MappingProfileEditor
            kind="transactions"
            csvHeaders={csvHeaders}
            existingProfile={editingProfile || undefined}
            onSave={handleProfileSave}
            onCancel={handleProfileEditorCancel}
          />
        </div>
      )}

      {/* Review Step */}
      {step === 'review' && selectedProfile && (
        <div>
          <h2>Review Import</h2>
          <p>
            Mapping profile: <strong>{selectedProfile.name}</strong>
          </p>
          <p>
            Rows to import: <strong>{csvRows.length}</strong>
          </p>

          <div
            style={{
              marginBottom: 'var(--space-4)',
              padding: '8px',
              background: 'var(--color-bg)',
              borderRadius: '4px',
              maxHeight: '200px',
              overflowY: 'auto',
            }}
          >
            <strong>CSV Headers → Mapped Fields:</strong>
            <div style={{ fontSize: '12px', marginTop: '8px' }}>
              {Object.entries(selectedProfile.fieldMap).map(([csvCol, field]) => (
                <div key={csvCol}>
                  {csvCol} → {field}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setStep('profile-select')}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: '1px solid var(--color-divider)',
                background: 'var(--color-surface)',
                cursor: 'pointer',
              }}
            >
              Back
            </button>
            <button
              onClick={handleApplyMapping}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: 'none',
                background: 'var(--color-accent)',
                color: 'var(--color-bg)',
                cursor: 'pointer',
              }}
            >
              Import
            </button>
          </div>
        </div>
      )}
      </div>
    </>
  )
}
