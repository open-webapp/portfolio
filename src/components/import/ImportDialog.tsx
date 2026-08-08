import { useCallback, useRef, useState } from 'react'
import type { AppState } from '../../lib/state'
import { parseCsvFile } from '../../lib/csv'
import type { TaxCategory, Account } from '../../lib/types'
import {
  POSITIONS_REQUIRED_FIELDS,
  POSITIONS_OPTIONAL_FIELDS,
  TRANSACTIONS_REQUIRED_FIELDS,
  TRANSACTIONS_OPTIONAL_FIELDS,
} from '../../lib/types'
import { listProfilesForKind, createProfile, updateProfile, applyMapping, validateProfile } from '../../lib/mappingProfiles'
import { uid } from '../../lib/seed'

export interface ImportDialogProps {
  state: AppState
  dispatch: (action: any) => void
  onClose: () => void
}

interface NewAccountFields {
  name: string
  number: string
  category: TaxCategory
  retirement: boolean
}

type DialogStep = 1 | 2 | 3 | 4

/**
 * ImportDialog: Unified 4-step CSV import dialog.
 * Step 1: Setup - choose data type, destination account (existing or new), select file
 * Step 2: Map columns - map CSV columns to fields, save mapping profiles
 * Steps 3-4: Implemented separately
 */
export function ImportDialog({ state, dispatch, onClose }: ImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Dialog state
  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState<DialogStep>(1)

  // Step 1 state
  const [dataType, setDataType] = useState<'positions' | 'transactions'>('positions')
  const [accountMode, setAccountMode] = useState<'existing' | 'new'>('existing')
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [newAccountFields, setNewAccountFields] = useState<NewAccountFields>({
    name: '',
    number: '',
    category: 'taxable',
    retirement: false,
  })
  const [file, setFile] = useState<File | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [fileError, setFileError] = useState<string>('')
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([])

  // Step 2 state - mapping and constants
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({})
  const [constants, setConstants] = useState<Record<string, string>>({})
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [profileMode, setProfileMode] = useState<'use-existing' | 'create-new'>('use-existing')
  const [profileName, setProfileName] = useState('')

  // Step 3 state - preview and validation
  const [importEdits, setImportEdits] = useState<Record<string, Record<string, string>>>({})

  // Step 4 state - import completion
  const [importDone, setImportDone] = useState(false)
  const [importedRowCount, setImportedRowCount] = useState(0)

  /**
   * Validate a single preview row for required fields and alternative pairs.
   * Returns {valid: boolean, errors: string[]}
   */
  const validatePreviewRow = useCallback(
    (dataType: 'positions' | 'transactions', values: Record<string, string>): { valid: boolean; errors: string[] } => {
      const errors: string[] = []

      if (dataType === 'positions') {
        // Check always-required fields
        if (!values.symbol?.trim()) errors.push('Missing symbol')
        if (!values.assetClass?.trim()) errors.push('Missing asset class')
        if (!values.shares?.trim()) errors.push('Missing shares')

        // Check alternative pairs
        if (!values.avgCost?.trim() && !values.purchaseAmount?.trim()) {
          errors.push('Missing cost basis (avgCost or purchaseAmount)')
        }
        if (!values.price?.trim() && !values.marketValue?.trim()) {
          errors.push('Missing price (price or marketValue)')
        }
      } else if (dataType === 'transactions') {
        // Check all required fields
        if (!values.date?.trim()) errors.push('Missing date')
        if (!values.symbol?.trim()) errors.push('Missing symbol')
        if (!values.type?.trim()) errors.push('Missing type')
        if (!values.shares?.trim()) errors.push('Missing shares')
        if (!values.price?.trim()) errors.push('Missing price')
        if (!values.amount?.trim()) errors.push('Missing amount')
      }

      return {
        valid: errors.length === 0,
        errors,
      }
    },
    []
  )

  const handleOpenDialog = useCallback(() => {
    setIsOpen(true)
  }, [])

  const handleCloseDialog = useCallback(() => {
    setIsOpen(false)
    setStep(1)
    setDataType('positions')
    setAccountMode('existing')
    setSelectedAccountId('')
    setNewAccountFields({
      name: '',
      number: '',
      category: 'taxable',
      retirement: false,
    })
    setFile(null)
    setFileName('')
    setFileError('')
    setCsvHeaders([])
    setCsvRows([])
    setFieldMap({})
    setConstants({})
    setSelectedProfileId('')
    setProfileMode('use-existing')
    setProfileName('')
    setImportEdits({})
    setImportDone(false)
    setImportedRowCount(0)
    onClose()
  }, [onClose])

  const handleFileSelect = useCallback(
    async (selectedFile: File | null) => {
      if (!selectedFile) {
        setFileError('')
        setFile(null)
        setFileName('')
        setCsvHeaders([])
        setCsvRows([])
        return
      }

      // Validate file type
      if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
        setFileError('Please select a CSV file')
        setFile(null)
        setFileName('')
        setCsvHeaders([])
        setCsvRows([])
        return
      }

      try {
        const parsed = await parseCsvFile(selectedFile)
        if (parsed.rows.length === 0) {
          setFileError('CSV file is empty')
          setFile(null)
          setFileName('')
          setCsvHeaders([])
          setCsvRows([])
          return
        }
        setFile(selectedFile)
        setFileName(selectedFile.name)
        setCsvHeaders(parsed.headers)
        setCsvRows(parsed.rows)
        setFileError('')
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        setFileError(`Error parsing CSV: ${errorMessage}`)
        setFile(null)
        setFileName('')
        setCsvHeaders([])
        setCsvRows([])
      }
    },
    []
  )

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0] || null
      handleFileSelect(selectedFile)
    },
    [handleFileSelect]
  )

  const handleFileDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const droppedFile = event.dataTransfer.files?.[0] || null
      handleFileSelect(droppedFile)
    },
    [handleFileSelect]
  )

  const handleFileDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const isStep1Complete = (): boolean => {
    // Data type must be chosen (always is, default to 'positions')
    // Account must be resolved
    const accountResolved =
      accountMode === 'existing'
        ? selectedAccountId !== ''
        : newAccountFields.name.trim() !== '' && newAccountFields.number.trim() !== ''
    // File must be selected and parsed with >= 1 row
    const fileSelected = file !== null && csvRows.length > 0
    return accountResolved && fileSelected
  }

  const isStep3Complete = (): boolean => {
    // All rows must be valid for Step 3 to complete
    const previewRows = csvRows.map((row) =>
      applyMapping(row, { fieldMap, constants } as any)
    )

    return previewRows.every((previewRow, idx) => {
      const editedRow = {
        ...previewRow,
        ...importEdits[idx],
      }
      const validation = validatePreviewRow(dataType, editedRow)
      return validation.valid
    })
  }

  const handleContinue = useCallback(() => {
    if (step === 1) {
      if (!isStep1Complete()) return
      // When entering Step 2, reset mapping state
      setFieldMap({})
      setConstants({})
      setSelectedProfileId('')
      setProfileName('')
      setStep(2)
    } else if (step === 2) {
      // Step 2 complete, proceed to Step 3
      setImportEdits({}) // Reset edits when entering Step 3
      setStep(3)
    } else if (step === 3) {
      // Step 3 complete, proceed to Step 4
      if (!isStep3Complete()) return
      setStep(4)
    }
  }, [step, csvRows.length, file, accountMode, selectedAccountId, newAccountFields, dataType, fieldMap, constants, importEdits, validatePreviewRow])

  const handleBack = useCallback(() => {
    setStep((s) => (s > 1 ? (s - 1) as DialogStep : 1))
  }, [])

  // Step 4: Handle import
  const handleImport = useCallback(() => {
    // Build preview rows
    const previewRows = csvRows.map((row) =>
      applyMapping(row, { fieldMap, constants } as any)
    )

    // Determine which rows are valid
    const validRowIndices: number[] = []
    const finalRows: Record<string, string>[] = []

    previewRows.forEach((previewRow, idx) => {
      const editedRow = {
        ...previewRow,
        ...importEdits[idx],
      }
      const validation = validatePreviewRow(dataType, editedRow)
      if (validation.valid) {
        validRowIndices.push(idx)
        finalRows.push(editedRow)
      }
    })

    // Determine the account ID
    let accountId = selectedAccountId

    // If new account mode, create the account first
    if (accountMode === 'new') {
      const newAccount: Account = {
        id: uid('acc'),
        accountNumber: newAccountFields.number,
        name: newAccountFields.name,
        taxCategory: newAccountFields.category,
        retirement: newAccountFields.retirement,
        createdAt: new Date().toISOString(),
      }
      accountId = newAccount.id
      dispatch({ type: 'ADD_ACCOUNT', account: newAccount })
    }

    // Generate a unique session ID for this import
    const importSessionId = uid('import')

    // Dispatch the import action
    if (dataType === 'positions') {
      dispatch({
        type: 'IMPORT_POSITIONS',
        accountId,
        mappedRows: finalRows,
        importDate: new Date().toISOString(),
        importSessionId,
        fileName,
      })
    } else {
      dispatch({
        type: 'IMPORT_TRANSACTIONS',
        accountId,
        mappedRows: finalRows,
        importSessionId,
        fileName,
      })
    }

    // Show completion state
    setImportDone(true)
    setImportedRowCount(finalRows.length)
  }, [
    csvRows,
    fieldMap,
    constants,
    importEdits,
    validatePreviewRow,
    dataType,
    accountMode,
    selectedAccountId,
    newAccountFields,
    dispatch,
  ])

  // Step 2: Handle profile selection
  const handleProfileSelect = useCallback(
    (profileId: string) => {
      setSelectedProfileId(profileId)
      if (profileId === 'create-new') {
        setFieldMap({})
        setConstants({})
      } else {
        const profile = state.mappingProfiles.find((p) => p.id === profileId)
        if (profile) {
          setFieldMap({ ...profile.fieldMap })
          setConstants(profile.constants ? { ...profile.constants } : {})
        }
      }
    },
    [state.mappingProfiles]
  )

  // Step 2: Handle field mapping change
  const handleFieldMapChange = useCallback((field: string, csvColumn: string) => {
    setFieldMap((prev) => {
      if (csvColumn === 'enter-value' || csvColumn === '') {
        // Remove the entry mapping to this field (fieldMap is { csvColumn: targetField })
        const next: Record<string, string> = {}
        for (const [col, target] of Object.entries(prev)) {
          if (target !== field) next[col] = target
        }
        return next
      } else {
        return {
          ...prev,
          [csvColumn]: field,
        }
      }
    })
  }, [])

  // Step 2: Handle constant value change
  const handleConstantChange = useCallback((field: string, value: string) => {
    setConstants((prev) => ({
      ...prev,
      [field]: value,
    }))
  }, [])

  // Step 2: Handle use-existing continue
  const handleUseExistingContinue = useCallback(() => {
    if (!selectedProfileId) return
    handleProfileSelect(selectedProfileId)
    setImportEdits({})
    setStep(3)
  }, [selectedProfileId, handleProfileSelect])

  // Step 2: Handle save profile and continue
  const handleSaveProfileAndContinue = useCallback(() => {
    const name = profileName.trim()
    if (!name) return
    if (!validateProfile(createProfile(name, dataType, fieldMap, constants), dataType).valid) return

    const existing = state.mappingProfiles.find(
      (p) => p.kind === dataType && p.name.trim().toLowerCase() === name.toLowerCase()
    )
    if (existing) {
      if (!window.confirm(`A mapping profile named '${existing.name}' already exists. Overwrite it with this mapping?`)) {
        return
      }
      const updated = updateProfile(existing, name, fieldMap, constants)
      dispatch({ type: 'UPDATE_MAPPING_PROFILE', profileId: existing.id, profile: updated })
      setSelectedProfileId(existing.id)
    } else {
      const created = createProfile(name, dataType, fieldMap, constants)
      dispatch({ type: 'ADD_MAPPING_PROFILE', profile: created })
      setSelectedProfileId(created.id)
    }

    setImportEdits({})
    setStep(3)
  }, [profileName, dataType, fieldMap, constants, state.mappingProfiles, dispatch])

  // Closed state: render button only
  if (!isOpen) {
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
        Import CSV
      </button>
    )
  }

  // Dialog is open, render Step 1
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
          maxWidth: 'min(1200px, 95vw)',
          maxHeight: '80vh',
          overflowY: 'auto',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        }}
      >
        <h2 style={{ marginBottom: 'var(--space-4)' }}>Import CSV</h2>

        {/* Step 1: Setup */}
        {step === 1 && (
          <div>
            {/* Data Type Selection */}
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                <strong>Data Type</strong>
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setDataType('positions')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    border: '1px solid var(--color-divider)',
                    borderRadius: '4px',
                    background:
                      dataType === 'positions'
                        ? 'var(--color-accent)'
                        : 'var(--color-bg)',
                    color:
                      dataType === 'positions'
                        ? 'var(--color-bg)'
                        : 'var(--color-text)',
                    cursor: 'pointer',
                  }}
                >
                  Positions
                </button>
                <button
                  onClick={() => setDataType('transactions')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    border: '1px solid var(--color-divider)',
                    borderRadius: '4px',
                    background:
                      dataType === 'transactions'
                        ? 'var(--color-accent)'
                        : 'var(--color-bg)',
                    color:
                      dataType === 'transactions'
                        ? 'var(--color-bg)'
                        : 'var(--color-text)',
                    cursor: 'pointer',
                  }}
                >
                  Transactions
                </button>
              </div>
            </div>

            {/* Account Mode Selection */}
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                <strong>Destination Account</strong>
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setAccountMode('existing')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    border: '1px solid var(--color-divider)',
                    borderRadius: '4px',
                    background:
                      accountMode === 'existing'
                        ? 'var(--color-accent)'
                        : 'var(--color-bg)',
                    color:
                      accountMode === 'existing'
                        ? 'var(--color-bg)'
                        : 'var(--color-text)',
                    cursor: 'pointer',
                  }}
                >
                  Existing
                </button>
                <button
                  onClick={() => setAccountMode('new')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    border: '1px solid var(--color-divider)',
                    borderRadius: '4px',
                    background:
                      accountMode === 'new'
                        ? 'var(--color-accent)'
                        : 'var(--color-bg)',
                    color:
                      accountMode === 'new'
                        ? 'var(--color-bg)'
                        : 'var(--color-text)',
                    cursor: 'pointer',
                  }}
                >
                  New
                </button>
              </div>
            </div>

            {/* Existing Account Selection */}
            {accountMode === 'existing' && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                  <strong>Select Account</strong>
                </label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid var(--color-divider)',
                    borderRadius: '4px',
                    background: 'var(--color-bg)',
                  }}
                >
                  <option value="">-- Select an account --</option>
                  {state.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.accountNumber})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* New Account Fields */}
            {accountMode === 'new' && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <label style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
                    <strong>Account Name</strong>
                  </label>
                  <input
                    type="text"
                    value={newAccountFields.name}
                    onChange={(e) =>
                      setNewAccountFields({
                        ...newAccountFields,
                        name: e.target.value,
                      })
                    }
                    placeholder="e.g., Fidelity Brokerage"
                    className="input"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid var(--color-divider)',
                      borderRadius: '4px',
                      background: 'var(--color-bg)',
                    }}
                  />
                </div>

                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <label style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
                    <strong>Account Number</strong>
                  </label>
                  <input
                    type="text"
                    value={newAccountFields.number}
                    onChange={(e) =>
                      setNewAccountFields({
                        ...newAccountFields,
                        number: e.target.value,
                      })
                    }
                    placeholder="e.g., 123456789"
                    className="input"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid var(--color-divider)',
                      borderRadius: '4px',
                      background: 'var(--color-bg)',
                    }}
                  />
                </div>

                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <label style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
                    <strong>Tax Category</strong>
                  </label>
                  <select
                    value={newAccountFields.category}
                    onChange={(e) =>
                      setNewAccountFields({
                        ...newAccountFields,
                        category: e.target.value as TaxCategory,
                      })
                    }
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid var(--color-divider)',
                      borderRadius: '4px',
                      background: 'var(--color-bg)',
                    }}
                  >
                    <option value="taxable">Taxable</option>
                    <option value="nonTaxable">Non-Taxable</option>
                    <option value="taxDeferred">Tax-Deferred</option>
                  </select>
                </div>

                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={newAccountFields.retirement}
                      onChange={(e) =>
                        setNewAccountFields({
                          ...newAccountFields,
                          retirement: e.target.checked,
                        })
                      }
                    />
                    <strong>Retirement Account</strong>
                  </label>
                </div>
              </div>
            )}

            {/* File Drop Zone */}
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                <strong>Select CSV File</strong>
              </label>
              <div
                onDrop={handleFileDrop}
                onDragOver={handleFileDragOver}
                style={{
                  border: '2px dashed var(--color-divider)',
                  borderRadius: '4px',
                  padding: 'var(--space-4)',
                  textAlign: 'center',
                  background: 'var(--color-bg)',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileInputChange}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '4px',
                    border: 'none',
                    background: 'var(--color-accent)',
                    color: 'var(--color-bg)',
                    cursor: 'pointer',
                  }}
                >
                  Choose File
                </button>
                <p style={{ margin: 'var(--space-2) 0 0 0', fontSize: '14px' }}>
                  or drag and drop a CSV file here
                </p>
                {file && (
                  <p
                    style={{
                      margin: 'var(--space-2) 0 0 0',
                      fontSize: '14px',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    Selected: <strong>{file.name}</strong> ({csvRows.length} rows)
                  </p>
                )}
              </div>
              {fileError && (
                <p
                  style={{
                    marginTop: 'var(--space-2)',
                    color: 'var(--color-accent-2-800)',
                    fontSize: '14px',
                  }}
                >
                  {fileError}
                </p>
              )}
            </div>

            {/* Action Buttons */}
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
              <button
                onClick={handleContinue}
                disabled={!isStep1Complete()}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  border: 'none',
                  background: isStep1Complete()
                    ? 'var(--color-accent)'
                    : 'var(--color-divider)',
                  color: isStep1Complete()
                    ? 'var(--color-bg)'
                    : 'var(--color-text-secondary)',
                  cursor: isStep1Complete() ? 'pointer' : 'not-allowed',
                }}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Map Columns */}
        {step === 2 && (
          <div>
            {(() => {
              const kindProfiles = listProfilesForKind(state.mappingProfiles, dataType)
              const effectiveMode = kindProfiles.length === 0 ? 'create-new' : profileMode
              const requiredMapped = validateProfile(
                createProfile(profileName.trim(), dataType, fieldMap, constants),
                dataType
              ).valid
              const canSaveAndContinue = profileName.trim() !== '' && requiredMapped

              return (
                <>
                  {kindProfiles.length > 0 && (
                    <div style={{ marginBottom: 'var(--space-4)' }}>
                      <label style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                        <strong>Mapping Source</strong>
                      </label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => setProfileMode('use-existing')}
                          style={{
                            flex: 1,
                            padding: '8px 12px',
                            border: '1px solid var(--color-divider)',
                            borderRadius: '4px',
                            background:
                              effectiveMode === 'use-existing'
                                ? 'var(--color-accent)'
                                : 'var(--color-bg)',
                            color:
                              effectiveMode === 'use-existing'
                                ? 'var(--color-bg)'
                                : 'var(--color-text)',
                            cursor: 'pointer',
                          }}
                        >
                          Use existing
                        </button>
                        <button
                          onClick={() => setProfileMode('create-new')}
                          style={{
                            flex: 1,
                            padding: '8px 12px',
                            border: '1px solid var(--color-divider)',
                            borderRadius: '4px',
                            background:
                              effectiveMode === 'create-new'
                                ? 'var(--color-accent)'
                                : 'var(--color-bg)',
                            color:
                              effectiveMode === 'create-new'
                                ? 'var(--color-bg)'
                                : 'var(--color-text)',
                            cursor: 'pointer',
                          }}
                        >
                          Create new
                        </button>
                      </div>
                    </div>
                  )}

                  {effectiveMode === 'use-existing' ? (
                    <>
                      <div style={{ marginBottom: 'var(--space-4)' }}>
                        <label style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                          <strong>Select Profile</strong>
                        </label>
                        <select
                          value={selectedProfileId}
                          onChange={(e) => handleProfileSelect(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid var(--color-divider)',
                            borderRadius: '4px',
                            background: 'var(--color-bg)',
                          }}
                        >
                          {kindProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button
                          onClick={handleBack}
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
                          onClick={handleUseExistingContinue}
                          disabled={selectedProfileId === ''}
                          style={{
                            padding: '8px 16px',
                            borderRadius: '4px',
                            border: 'none',
                            background: selectedProfileId !== ''
                              ? 'var(--color-accent)'
                              : 'var(--color-divider)',
                            color: selectedProfileId !== ''
                              ? 'var(--color-bg)'
                              : 'var(--color-text-secondary)',
                            cursor: selectedProfileId !== '' ? 'pointer' : 'not-allowed',
                          }}
                        >
                          Continue
                        </button>
                      </div>
                    </>
                  ) : (
                    <>

            {/* Mapping grid */}
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <strong style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                Field Mapping
              </strong>
              <div
                style={{
                  border: '1px solid var(--color-divider)',
                  borderRadius: '4px',
                  overflow: 'auto',
                }}
              >
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '14px',
                  }}
                >
                  <thead>
                    <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-divider)' }}>
                      <th
                        style={{
                          padding: '8px 12px',
                          textAlign: 'left',
                          fontWeight: '600',
                          width: '40%',
                        }}
                      >
                        Field
                      </th>
                      <th
                        style={{
                          padding: '8px 12px',
                          textAlign: 'left',
                          fontWeight: '600',
                          width: '60%',
                        }}
                      >
                        CSV Column or Constant Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const requiredFields =
                        dataType === 'positions'
                          ? POSITIONS_REQUIRED_FIELDS
                          : TRANSACTIONS_REQUIRED_FIELDS
                      const optionalFields =
                        dataType === 'positions'
                          ? POSITIONS_OPTIONAL_FIELDS
                          : TRANSACTIONS_OPTIONAL_FIELDS

                      return (
                        <>
                          {/* Required fields */}
                          {(requiredFields as readonly string[]).map((field) => (
                            <tr
                              key={field}
                              style={{
                                borderBottom: '1px solid var(--color-divider)',
                              }}
                            >
                              <td style={{ padding: '8px 12px', fontWeight: '500' }}>
                                {field}
                              </td>
                              <td style={{ padding: '8px 12px' }}>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                  <select
                                    value={
                                      constants[field]
                                        ? 'enter-value'
                                        : Object.keys(fieldMap).find((col) => fieldMap[col] === field) ?? ''
                                    }
                                    onChange={(e) => handleFieldMapChange(field, e.target.value)}
                                    style={{
                                      flex: 1,
                                      padding: '6px 8px',
                                      border: '1px solid var(--color-divider)',
                                      borderRadius: '3px',
                                      background: 'var(--color-bg)',
                                      fontSize: '14px',
                                    }}
                                  >
                                    <option value="">-- Select column --</option>
                                    {csvHeaders.map((header) => (
                                      <option key={header} value={header}>
                                        {header}
                                      </option>
                                    ))}
                                    <option value="enter-value">Enter a value…</option>
                                  </select>
                                </div>
                                {constants[field] && (
                                  <input
                                    type="text"
                                    value={constants[field]}
                                    onChange={(e) =>
                                      handleConstantChange(field, e.target.value)
                                    }
                                    placeholder="Constant value"
                                    style={{
                                      width: '100%',
                                      padding: '6px 8px',
                                      border: '1px solid var(--color-divider)',
                                      borderRadius: '3px',
                                      background: 'var(--color-bg)',
                                      fontSize: '14px',
                                      marginTop: '6px',
                                    }}
                                  />
                                )}
                              </td>
                            </tr>
                          ))}

                          {/* Optional fields */}
                          {(optionalFields as readonly string[]).map((field) => (
                            <tr
                              key={field}
                              style={{
                                borderBottom: '1px solid var(--color-divider)',
                                background: 'var(--color-bg-secondary)',
                              }}
                            >
                              <td style={{ padding: '8px 12px', fontWeight: '500', opacity: 0.8 }}>
                                {field} (optional)
                              </td>
                              <td style={{ padding: '8px 12px' }}>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                  <select
                                    value={
                                      constants[field]
                                        ? 'enter-value'
                                        : Object.keys(fieldMap).find((col) => fieldMap[col] === field) ?? ''
                                    }
                                    onChange={(e) => handleFieldMapChange(field, e.target.value)}
                                    style={{
                                      flex: 1,
                                      padding: '6px 8px',
                                      border: '1px solid var(--color-divider)',
                                      borderRadius: '3px',
                                      background: 'var(--color-bg)',
                                      fontSize: '14px',
                                    }}
                                  >
                                    <option value="">-- Select column --</option>
                                    {csvHeaders.map((header) => (
                                      <option key={header} value={header}>
                                        {header}
                                      </option>
                                    ))}
                                    <option value="enter-value">Enter a value…</option>
                                  </select>
                                </div>
                                {constants[field] && (
                                  <input
                                    type="text"
                                    value={constants[field]}
                                    onChange={(e) =>
                                      handleConstantChange(field, e.target.value)
                                    }
                                    placeholder="Constant value"
                                    style={{
                                      width: '100%',
                                      padding: '6px 8px',
                                      border: '1px solid var(--color-divider)',
                                      borderRadius: '3px',
                                      background: 'var(--color-bg)',
                                      fontSize: '14px',
                                      marginTop: '6px',
                                    }}
                                  />
                                )}
                              </td>
                            </tr>
                          ))}
                        </>
                      )
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

                      <div style={{ marginBottom: 'var(--space-4)' }}>
                        <label style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                          <strong>Profile Name</strong>
                        </label>
                        <input
                          type="text"
                          value={profileName}
                          onChange={(e) => setProfileName(e.target.value)}
                          placeholder="e.g., Fidelity Positions"
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid var(--color-divider)',
                            borderRadius: '4px',
                            background: 'var(--color-bg)',
                          }}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button
                          onClick={handleBack}
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
                          onClick={handleSaveProfileAndContinue}
                          disabled={!canSaveAndContinue}
                          style={{
                            padding: '8px 16px',
                            borderRadius: '4px',
                            border: 'none',
                            background: canSaveAndContinue
                              ? 'var(--color-accent)'
                              : 'var(--color-divider)',
                            color: canSaveAndContinue
                              ? 'var(--color-bg)'
                              : 'var(--color-text-secondary)',
                            cursor: canSaveAndContinue ? 'pointer' : 'not-allowed',
                          }}
                        >
                          Save Profile & Continue
                        </button>
                      </div>
                    </>
                  )}
                </>
              )
            })()}
          </div>
        )}

        {/* Step 3: Preview & Validate */}
        {step === 3 && (
          <div>
            <p style={{ marginBottom: 'var(--space-4)', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
              Review and edit the imported data below. Fix any errors to continue.
            </p>

            {(() => {
              // Build preview rows
              const previewRows = csvRows.map((row) =>
                applyMapping(row, { fieldMap, constants } as any)
              )

              // Get field list (required + optional for this data type)
              const requiredFields = dataType === 'positions'
                ? POSITIONS_REQUIRED_FIELDS
                : TRANSACTIONS_REQUIRED_FIELDS
              const optionalFields = dataType === 'positions'
                ? POSITIONS_OPTIONAL_FIELDS
                : TRANSACTIONS_OPTIONAL_FIELDS
              const allFields = [...requiredFields, ...optionalFields]

              // Validate all rows
              const rowValidations = previewRows.map((previewRow, idx) => {
                const editedRow = {
                  ...previewRow,
                  ...importEdits[idx],
                }
                return validatePreviewRow(dataType, editedRow)
              })

              const validRowCount = rowValidations.filter((v) => v.valid).length
              const hasErrors = rowValidations.some((v) => !v.valid)

              return (
                <div>
                  {/* Row count summary */}
                  <div
                    style={{
                      marginBottom: 'var(--space-4)',
                      padding: 'var(--space-3)',
                      background: 'var(--color-bg)',
                      borderRadius: '4px',
                      fontSize: '14px',
                    }}
                  >
                    <strong>
                      {validRowCount} of {previewRows.length} rows valid
                    </strong>
                  </div>

                  {/* Editable preview table */}
                  <div
                    style={{
                      border: '1px solid var(--color-divider)',
                      borderRadius: '4px',
                      overflow: 'auto',
                      marginBottom: 'var(--space-4)',
                      maxHeight: '400px',
                    }}
                  >
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '13px',
                      }}
                    >
                      <thead style={{ position: 'sticky', top: 0 }}>
                        <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-divider)' }}>
                          <th
                            style={{
                              padding: '8px 12px',
                              textAlign: 'center',
                              fontWeight: '600',
                              width: '50px',
                            }}
                          >
                            Row
                          </th>
                          {(allFields as readonly string[]).map((field) => (
                            <th
                              key={field}
                              style={{
                                padding: '8px 12px',
                                textAlign: 'left',
                                fontWeight: '600',
                                minWidth: '100px',
                              }}
                            >
                              {field}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((previewRow, rowIdx) => {
                          const editedRow = {
                            ...previewRow,
                            ...importEdits[rowIdx],
                          }
                          const validation = validatePreviewRow(dataType, editedRow)
                          const hasRowError = !validation.valid

                          return (
                            <tr
                              key={rowIdx}
                              style={{
                                background: hasRowError ? 'rgba(200, 50, 50, 0.05)' : 'transparent',
                                borderBottom: '1px solid var(--color-divider)',
                              }}
                            >
                              <td
                                style={{
                                  padding: '8px 12px',
                                  textAlign: 'center',
                                  fontWeight: '500',
                                  color: hasRowError ? 'var(--color-accent-2-800)' : 'var(--color-text-secondary)',
                                }}
                              >
                                {rowIdx + 1}
                                {hasRowError && <span style={{ display: 'block', fontSize: '10px' }}>✕</span>}
                              </td>
                              {(allFields as readonly string[]).map((field) => {
                                const cellValue = editedRow[field] ?? ''
                                const isRequiredMissing =
                                  (requiredFields as readonly string[]).includes(field) &&
                                  !cellValue.trim() &&
                                  // Exception: avgCost/purchaseAmount and price/marketValue have alternatives
                                  !(
                                    (field === 'avgCost' && editedRow.purchaseAmount?.trim()) ||
                                    (field === 'purchaseAmount' && editedRow.avgCost?.trim()) ||
                                    (field === 'price' && editedRow.marketValue?.trim()) ||
                                    (field === 'marketValue' && editedRow.price?.trim())
                                  )
                                const cellHasError = isRequiredMissing

                                return (
                                  <td
                                    key={field}
                                    style={{
                                      padding: '8px 12px',
                                      background: cellHasError ? 'rgba(200, 50, 50, 0.1)' : 'transparent',
                                    }}
                                  >
                                    <input
                                      type="text"
                                      value={cellValue}
                                      onChange={(e) => {
                                        setImportEdits((prev) => ({
                                          ...prev,
                                          [rowIdx]: {
                                            ...prev[rowIdx],
                                            [field]: e.target.value,
                                          },
                                        }))
                                      }}
                                      style={{
                                        width: '100%',
                                        padding: '6px 8px',
                                        border: cellHasError
                                          ? '1px solid var(--color-accent-2-800)'
                                          : '1px solid var(--color-divider)',
                                        borderRadius: '3px',
                                        background: 'var(--color-surface)',
                                        fontSize: '13px',
                                        boxSizing: 'border-box',
                                      }}
                                    />
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Error summary */}
                  {hasErrors && (
                    <div
                      style={{
                        marginBottom: 'var(--space-4)',
                        padding: 'var(--space-3)',
                        background: 'rgba(200, 50, 50, 0.05)',
                        border: '1px solid var(--color-accent-2-800)',
                        borderRadius: '4px',
                        fontSize: '13px',
                      }}
                    >
                      <strong style={{ color: 'var(--color-accent-2-800)' }}>Validation errors:</strong>
                      <ul
                        style={{
                          margin: 'var(--space-1) 0 0 var(--space-4)',
                          paddingLeft: '20px',
                          color: 'var(--color-accent-2-800)',
                        }}
                      >
                        {rowValidations.map((validation, idx) =>
                          validation.errors.map((error) => (
                            <li key={`${idx}-${error}`} style={{ margin: '4px 0' }}>
                              Row {idx + 1}: {error}
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={handleBack}
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
                      onClick={handleContinue}
                      disabled={hasErrors}
                      style={{
                        padding: '8px 16px',
                        borderRadius: '4px',
                        border: 'none',
                        background: hasErrors
                          ? 'var(--color-divider)'
                          : 'var(--color-accent)',
                        color: hasErrors
                          ? 'var(--color-text-secondary)'
                          : 'var(--color-bg)',
                        cursor: hasErrors ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Review Import
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* Step 4: Confirm & Import */}
        {step === 4 && (
          <div>
            {!importDone ? (
              <div>
                {/* Review Card */}
                <div
                  style={{
                    marginBottom: 'var(--space-4)',
                    padding: 'var(--space-4)',
                    border: '1px solid var(--color-divider)',
                    borderRadius: '4px',
                    background: 'var(--color-bg)',
                  }}
                >
                  <h3 style={{ marginBottom: 'var(--space-3)' }}>Import Summary</h3>

                  {/* Data Type */}
                  <div style={{ marginBottom: 'var(--space-3)' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--space-1)', fontSize: '12px', opacity: 0.7 }}>
                      Data Type
                    </label>
                    <p style={{ margin: 0, fontWeight: '500' }}>
                      {dataType === 'positions' ? 'Positions' : 'Transactions'}
                    </p>
                  </div>

                  {/* Destination Account */}
                  <div style={{ marginBottom: 'var(--space-3)' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--space-1)', fontSize: '12px', opacity: 0.7 }}>
                      Destination Account
                    </label>
                    <p style={{ margin: 0, fontWeight: '500' }}>
                      {accountMode === 'existing'
                        ? state.accounts.find((a) => a.id === selectedAccountId)?.name || 'Unknown'
                        : newAccountFields.name}
                    </p>
                  </div>

                  {/* Valid Row Count */}
                  <div>
                    <label style={{ display: 'block', marginBottom: 'var(--space-1)', fontSize: '12px', opacity: 0.7 }}>
                      Rows to Import
                    </label>
                    <p style={{ margin: 0, fontWeight: '500' }}>
                      {(() => {
                        const previewRows = csvRows.map((row) =>
                          applyMapping(row, { fieldMap, constants } as any)
                        )
                        const validRows = previewRows.filter((previewRow, idx) => {
                          const editedRow = {
                            ...previewRow,
                            ...importEdits[idx],
                          }
                          const validation = validatePreviewRow(dataType, editedRow)
                          return validation.valid
                        })
                        return validRows.length
                      })()}{' '}
                      of {csvRows.length}
                    </p>
                  </div>
                </div>

                {/* Action Buttons - no Back button on Step 4 */}
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
                  <button
                    onClick={handleImport}
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
            ) : (
              <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                <h3 style={{ marginBottom: 'var(--space-3)', color: 'var(--color-text)' }}>
                  Import Complete
                </h3>
                <p style={{ marginBottom: 'var(--space-4)', fontSize: '16px', fontWeight: '500' }}>
                  Successfully imported {importedRowCount}{' '}
                  {dataType === 'positions'
                    ? importedRowCount === 1
                      ? 'position'
                      : 'positions'
                    : importedRowCount === 1
                    ? 'transaction'
                    : 'transactions'}
                </p>
                <button
                  onClick={handleCloseDialog}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '4px',
                    border: 'none',
                    background: 'var(--color-accent)',
                    color: 'var(--color-bg)',
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
