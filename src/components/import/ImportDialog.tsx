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
import { applyFieldMap, validatePreviewRow, isReviewValid, isBlankRow } from '../../lib/importPreview'
import { uid } from '../../lib/seed'
import { Trash } from 'lucide-react'

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

const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  taxable: 'Taxable',
  nonTaxable: 'Non-Taxable',
  taxDeferred: 'Tax-Deferred',
}

const FIELD_LABELS: Record<string, string> = {
  symbol: 'Symbol',
  name: 'Name',
  assetClass: 'Asset Class',
  shares: 'Shares',
  avgCost: 'Cost Basis',
  purchaseAmount: 'Purchase Amount',
  price: 'Price',
  marketValue: 'Market Value',
  date: 'Date',
  type: 'Type',
  amount: 'Amount',
  taxes: 'Taxes',
}

const FIELD_HINTS: Record<string, string> = {
  avgCost: 'Alternative: Purchase Amount (avgCost = purchaseAmount ÷ shares)',
  purchaseAmount: 'Alternative: Cost Basis (avgCost = purchaseAmount ÷ shares)',
  price: 'Alternative: Market Value (price = marketValue ÷ shares)',
  marketValue: 'Alternative: Price (price = marketValue ÷ shares)',
  amount: 'Total cash value of the transaction (shares × price)',
}

type DialogStep = 1 | 2

/**
 * ImportDialog: Unified 2-step CSV import dialog.
 * Step 1: Setup - choose data type, destination account (existing or new), select file
 * Step 2: Review - map CSV columns to fields, edit preview rows, import
 */
export function ImportDialog({ state, dispatch, onClose }: ImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Dialog state
  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState<DialogStep>(1)

  // Step 1 state
  const [dataType, setDataType] = useState<'positions' | 'transactions'>('positions')
  const [entryMode, setEntryMode] = useState<'upload' | 'manual'>('upload')
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

  // Step 2 state - column mapping, editable preview, import completion
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({})
  const [importEdits, setImportEdits] = useState<Record<string, Record<string, string>>>({})
  const [importDone, setImportDone] = useState(false)
  const [importedRowCount, setImportedRowCount] = useState(0)
  const [assetClassHeaderValue, setAssetClassHeaderValue] = useState<string>('')
  const [touchedAssetClassRows, setTouchedAssetClassRows] = useState<Set<number>>(new Set())

  const handleOpenDialog = useCallback(() => {
    setIsOpen(true)
  }, [])

  const handleCloseDialog = useCallback(() => {
    setIsOpen(false)
    setStep(1)
    setDataType('positions')
    setEntryMode('upload')
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
    setImportEdits({})
    setImportDone(false)
    setImportedRowCount(0)
    setAssetClassHeaderValue('')
    setTouchedAssetClassRows(new Set())
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
    // In manual mode there is no CSV file requirement.
    const fileSelected = entryMode === 'manual' || (file !== null && csvRows.length > 0)
    return accountResolved && fileSelected
  }

  const handleContinue = useCallback(() => {
    if (step === 1) {
      if (!isStep1Complete()) return

      if (entryMode === 'manual') {
        setCsvRows(Array.from({ length: 10 }, () => ({})))
      } else {
        // Prefill fieldMap from saved mapping if importing to existing account
        if (accountMode === 'existing' && selectedAccountId) {
          const saved = state.csvMappings.find(
            (m) => m.accountId === selectedAccountId && m.kind === dataType
          )
          if (saved) {
            // Filter saved fieldMap to only columns present in current CSV
            const prefill = Object.fromEntries(
              Object.entries(saved.fieldMap).filter(([csvCol]) => csvHeaders.includes(csvCol))
            )
            setFieldMap(prefill)
          }
          // If no saved mapping, leave fieldMap as-is (preserves manual mappings from back-and-continue flow)
        }
        // For new account mode, also leave fieldMap as-is (user's manual mappings already set)
      }

      setStep(2)
    }
  }, [step, isStep1Complete, entryMode, accountMode, selectedAccountId, dataType, csvHeaders, state.csvMappings])

  const handleBack = useCallback(() => {
    setStep(1)
  }, [])

  // Step 2: Handle field mapping change
  const handleFieldMapChange = useCallback((field: string, csvColumn: string) => {
    setFieldMap((prev) => {
      // Remove any existing column mapped to this field (fieldMap is { csvColumn: targetField })
      const next: Record<string, string> = {}
      for (const [col, target] of Object.entries(prev)) {
        if (target !== field) next[col] = target
      }
      if (csvColumn !== '') next[csvColumn] = field
      return next
    })
  }, [])

  // Step 2: Handle asset class header value change (broadcasts to all non-touched rows)
  const handleAssetClassHeaderChange = useCallback((value: string) => {
    setAssetClassHeaderValue(value)
    setImportEdits((prev) => {
      const next: Record<string, Record<string, string>> = {}
      for (let idx = 0; idx < csvRows.length; idx++) {
        next[idx] = { ...prev[idx] }
      }
      // For rows not in touchedAssetClassRows, set assetClass to the header value
      for (let idx = 0; idx < csvRows.length; idx++) {
        if (!touchedAssetClassRows.has(idx)) {
          next[idx] = {
            ...next[idx],
            assetClass: value,
          }
        }
      }
      return next
    })
  }, [csvRows.length, touchedAssetClassRows])

  // Step 2: Drop a row from the preview (removes it from csvRows and re-keys importEdits)
  const handleDeleteRow = useCallback((rowIdx: number) => {
    setCsvRows((prev) => prev.filter((_, idx) => idx !== rowIdx))
    setImportEdits((prev) => {
      const next: Record<string, Record<string, string>> = {}
      for (const [key, value] of Object.entries(prev)) {
        const idx = Number(key)
        if (idx === rowIdx) continue
        next[idx > rowIdx ? String(idx - 1) : key] = value
      }
      return next
    })
    setTouchedAssetClassRows((prev) => {
      const next = new Set(prev)
      next.delete(rowIdx)
      for (const idx of next) {
        if (idx > rowIdx) {
          next.delete(idx)
          next.add(idx - 1)
        }
      }
      return next
    })
  }, [])

  // Step 2: Build final rows from edited + validated preview and dispatch the import
  const handleImport = useCallback(() => {
    const previewRows = csvRows.map((row) => applyFieldMap(row, fieldMap))

    const finalRows: Record<string, string>[] = []
    previewRows.forEach((previewRow, idx) => {
      const editedRow = {
        ...previewRow,
        ...importEdits[idx],
      }
      const validation = validatePreviewRow(dataType, editedRow)
      if (validation.valid && !isBlankRow(editedRow)) finalRows.push(editedRow)
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

    // Save mappings only for CSV-upload sessions.
    if (entryMode === 'upload') {
      dispatch({ type: 'UPSERT_CSV_MAPPING', accountId, kind: dataType, fieldMap })
    }

    // Show completion state
    setImportDone(true)
    setImportedRowCount(finalRows.length)
  }, [
    csvRows,
    fieldMap,
    importEdits,
    dataType,
    accountMode,
    entryMode,
    selectedAccountId,
    newAccountFields,
    dispatch,
  ])

  const handlePrimary = useCallback(() => {
    if (importDone) {
      handleCloseDialog()
      return
    }
    handleImport()
  }, [importDone, handleImport, handleCloseDialog])

  // Closed state: render button only
  if (!isOpen) {
    return (
      <button type="button" className="btn btn-secondary blueprint" onClick={handleOpenDialog} aria-label="Import">
        <i className="corner tl"></i>
        <i className="corner tr"></i>
        <i className="corner bl"></i>
        <i className="corner br"></i>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="14"
          height="14"
          style={{ marginRight: '6px', verticalAlign: '-2px' }}
        >
          <path d="M12 3v12"></path>
          <path d="m7 8 5-5 5 5"></path>
          <path d="M5 21h14"></path>
        </svg>
        Import
      </button>
    )
  }

  // Derived Step 2 review state
  const previewRows = csvRows.map((row) => applyFieldMap(row, fieldMap))
  const requiredFields =
    dataType === 'positions' ? POSITIONS_REQUIRED_FIELDS : TRANSACTIONS_REQUIRED_FIELDS
  const optionalFields =
    dataType === 'positions' ? POSITIONS_OPTIONAL_FIELDS : TRANSACTIONS_OPTIONAL_FIELDS
  const allFields = [...requiredFields, ...optionalFields]
  const isManualAssetClassOnlyRow = (row: Record<string, string>): boolean =>
    entryMode === 'manual' &&
    dataType === 'positions' &&
    Object.entries(row).every(([field, value]) => (field === 'assetClass' ? true : !value.trim()))
  const rowValidations = previewRows.map((previewRow, idx) =>
    validatePreviewRow(dataType, {
      ...previewRow,
      ...importEdits[idx],
    })
  )
  const validRowCount = rowValidations.filter((v) => v.valid).length
  const errorCount = rowValidations.length - validRowCount
  const hasImportErrors = rowValidations.some((v, idx) => {
    if (v.valid) return false
    return !isManualAssetClassOnlyRow({
      ...previewRows[idx],
      ...importEdits[idx],
    })
  })
  const hasNoValidManualRows =
    entryMode === 'manual' &&
    rowValidations.every((v, idx) => {
      if (!v.valid) return true
      const mergedRow = {
        ...previewRows[idx],
        ...importEdits[idx],
      }
      return isBlankRow(mergedRow) || isManualAssetClassOnlyRow(mergedRow)
    })

  const destinationAccount =
    accountMode === 'existing' ? state.accounts.find((a) => a.id === selectedAccountId) : null
  const accountLabel =
    accountMode === 'existing'
      ? destinationAccount
        ? destinationAccount.name +
          (destinationAccount.accountNumber ? ` • #${destinationAccount.accountNumber}` : '')
        : ''
      : newAccountFields.name
  const categoryLabel =
    accountMode === 'existing'
      ? destinationAccount
        ? TAX_CATEGORY_LABELS[destinationAccount.taxCategory]
        : ''
      : TAX_CATEGORY_LABELS[newAccountFields.category]

  const mappedColumnFor = (field: string): string =>
    Object.keys(fieldMap).find((col) => fieldMap[col] === field) ?? ''

  // Dialog is open
  return (
    <>
      <div className="dialog-backdrop" onClick={handleCloseDialog} style={{ zIndex: 1000 }}>
        <div
          className="dialog blueprint"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 'min(96vw, 1400px)',
            maxWidth: '96vw',
            maxHeight: '88vh',
            overflow: 'auto',
            background: 'var(--color-bg)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <i className="corner tl"></i>
          <i className="corner tr"></i>
          <i className="corner bl"></i>
          <i className="corner br"></i>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="dialog-title">Import</div>
            <button
              type="button"
              onClick={handleCloseDialog}
              aria-label="Close"
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: 'var(--color-text)',
                opacity: 0.6,
                padding: '4px',
                lineHeight: 0,
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                width="18"
                height="18"
              >
                <path d="M18 6 6 18"></path>
                <path d="m6 6 12 12"></path>
              </svg>
            </button>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
            {[
              { num: 1, label: 'Setup', active: step === 1, completed: step > 1 },
              { num: 2, label: 'Review', active: step === 2, completed: step > 2 },
            ].map((s) => (
              <div key={s.num} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                <span className={`tag ${s.active ? 'tag-accent' : s.completed ? 'tag-neutral' : 'tag-outline'}`}>
                  {s.num}
                </span>
                <span className={s.active ? '' : 'text-muted'}>{s.label}</span>
              </div>
            ))}
          </div>

        {/* Step 1: Setup */}
        {step === 1 && (
          <div style={{ maxWidth: '720px' }}>
            <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
              <label>What are you importing?</label>
              <div className="seg" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', width: '100%' }}>
                <label className="seg-opt">
                  <input
                    type="radio"
                    name="importDataType"
                    checked={dataType === 'transactions'}
                    onChange={() => {
                      setDataType('transactions')
                      setEntryMode('upload')
                    }}
                  />
                  <span>Transactions</span>
                </label>
                <label className="seg-opt">
                  <input
                    type="radio"
                    name="importDataType"
                    checked={dataType === 'positions'}
                    onChange={() => setDataType('positions')}
                  />
                  <span>Positions / Holdings</span>
                </label>
              </div>
            </div>

            <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
              <label>Destination account</label>
              <div className="seg" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', width: '100%' }}>
                <label className="seg-opt">
                  <input
                    type="radio"
                    name="importAccountMode"
                    checked={accountMode === 'existing'}
                    onChange={() => setAccountMode('existing')}
                  />
                  <span>Existing account</span>
                </label>
                <label className="seg-opt">
                  <input
                    type="radio"
                    name="importAccountMode"
                    checked={accountMode === 'new'}
                    onChange={() => setAccountMode('new')}
                  />
                  <span>New account</span>
                </label>
              </div>
            </div>

            {accountMode === 'existing' && (
              <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
                <label>Account</label>
                <select
                  className="input"
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                >
                  <option value="">-- Select an account --</option>
                  {state.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                      {account.accountNumber ? ` • #${account.accountNumber}` : ''}
                      {' — '}
                      {TAX_CATEGORY_LABELS[account.taxCategory]}
                      {' — '}
                      {account.retirement ? 'Retirement' : 'Non-Retirement'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {accountMode === 'new' && (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr',
                    gap: 'var(--space-3)',
                    marginBottom: 'var(--space-3)',
                  }}
                >
                  <div className="field">
                    <label>New account name</label>
                    <input
                      type="text"
                      className="input"
                      value={newAccountFields.name}
                      onChange={(e) =>
                        setNewAccountFields({
                          ...newAccountFields,
                          name: e.target.value,
                        })
                      }
                      placeholder="e.g. Fidelity Rollover IRA"
                    />
                  </div>
                  <div className="field">
                    <label>Account number</label>
                    <input
                      type="text"
                      className="input"
                      value={newAccountFields.number}
                      onChange={(e) =>
                        setNewAccountFields({
                          ...newAccountFields,
                          number: e.target.value,
                        })
                      }
                      placeholder="e.g. 8842-1190"
                    />
                  </div>
                  <div className="field">
                    <label>Category</label>
                    <select
                      className="input"
                      value={newAccountFields.category}
                      onChange={(e) =>
                        setNewAccountFields({
                          ...newAccountFields,
                          category: e.target.value as TaxCategory,
                        })
                      }
                    >
                      <option value="taxable">Taxable</option>
                      <option value="nonTaxable">Non-Taxable</option>
                      <option value="taxDeferred">Tax-Deferred</option>
                    </select>
                  </div>
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
              </>
            )}

            {dataType === 'positions' && (
              <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
                <label>How would you like to add positions?</label>
                <div className="seg" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', width: '100%' }}>
                  <label className="seg-opt">
                    <input
                      type="radio"
                      name="importEntryMode"
                      checked={entryMode === 'upload'}
                      onChange={() => setEntryMode('upload')}
                    />
                    <span>Upload CSV file</span>
                  </label>
                  <label className="seg-opt">
                    <input
                      type="radio"
                      name="importEntryMode"
                      checked={entryMode === 'manual'}
                      onChange={() => setEntryMode('manual')}
                    />
                    <span>Enter manually</span>
                  </label>
                </div>
              </div>
            )}

            {entryMode === 'upload' && (
              <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
                <label>CSV file</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleFileDrop}
                  onDragOver={handleFileDragOver}
                  style={{
                    border: '1px dashed var(--color-divider)',
                    padding: 'var(--space-6)',
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileInputChange}
                    style={{ display: 'none' }}
                  />
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    width="22"
                    height="22"
                    style={{ color: 'var(--color-accent)', marginBottom: '8px' }}
                  >
                    <path d="M12 3v12"></path>
                    <path d="m7 8 5-5 5 5"></path>
                    <path d="M5 21h14"></path>
                  </svg>
                  <div>{file ? file.name : 'No file selected'}</div>
                  <div className="text-muted" style={{ fontSize: '11px', marginTop: '4px' }}>
                    Drag and drop, or click to browse
                  </div>
                  {file && (
                    <div style={{ margin: 'var(--space-2) 0 0 0', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                      Selected: <strong>{file.name}</strong> ({csvRows.length} rows)
                    </div>
                  )}
                </div>
                {fileError && (
                  <div style={{ color: '#8a3c2e', fontSize: '12px', marginTop: '6px' }}>{fileError}</div>
                )}
              </div>
            )}

            <div className="dialog-actions">
              <button className="btn btn-primary" onClick={handleContinue} disabled={!isStep1Complete()}>
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Review */}
        {step === 2 && (
          <div>
            {importDone ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-6) 0' }}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width="40"
                  height="40"
                  style={{ color: 'var(--color-accent-700)' }}
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <path d="m9 11 3 3L22 4"></path>
                </svg>
                <div className="card-title" style={{ margin: 'var(--space-3) 0 4px' }}>
                  Import complete
                </div>
                <div className="text-muted">
                  Successfully imported {importedRowCount}{' '}
                  {dataType === 'positions'
                    ? importedRowCount === 1
                      ? 'position'
                      : 'positions'
                    : importedRowCount === 1
                    ? 'transaction'
                    : 'transactions'}
                  .
                </div>
              </div>
            ) : (
              <>
                <div className="text-muted" style={{ fontSize: '12px', marginBottom: 'var(--space-3)' }}>
                  Importing into{' '}
                  <strong style={{ color: 'var(--color-text)' }}>{accountLabel}</strong> · {categoryLabel}
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 'var(--space-3)',
                    flexWrap: 'wrap',
                    gap: '6px',
                  }}
                >
                  <div className="text-muted" style={{ fontSize: '12px' }}>
                    Pick the file's column for each field below. {previewRows.length} row(s) detected ·{' '}
                    {validRowCount} valid. Fields marked * are required.
                  </div>
                  {hasImportErrors && (
                    <span className="tag tag-outline">
                      {errorCount} row(s) need fixing before you can continue
                    </span>
                  )}
                </div>
                <div
                  style={{
                    maxHeight: '420px',
                    overflow: 'auto',
                    border: '1px solid var(--color-divider)',
                    width: '100%',
                  }}
                >
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: '32px' }}></th>
                        {(allFields as readonly string[]).map((field) => (
                          <th
                            key={field}
                            style={{ whiteSpace: 'nowrap', verticalAlign: 'top', minWidth: '150px' }}
                          >
                            <div>
                              {FIELD_LABELS[field] ?? field}
                              {(requiredFields as readonly string[]).includes(field) && <span>*</span>}
                            </div>
                            {field === 'assetClass' && dataType === 'positions' ? (
                              <input
                                type="text"
                                className="input"
                                style={{
                                  marginTop: '6px',
                                  fontWeight: 400,
                                  textTransform: 'none',
                                  letterSpacing: 'normal',
                                }}
                                value={assetClassHeaderValue}
                                onChange={(e) => handleAssetClassHeaderChange(e.target.value)}
                                placeholder="e.g. Equity"
                              />
                            ) : entryMode === 'manual' && dataType === 'positions' ? null : (
                              <select
                                className="input"
                                style={{
                                  marginTop: '6px',
                                  fontWeight: 400,
                                  textTransform: 'none',
                                  letterSpacing: 'normal',
                                }}
                                value={mappedColumnFor(field)}
                                onChange={(e) => handleFieldMapChange(field, e.target.value)}
                              >
                                <option value="">— Not mapped —</option>
                                {csvHeaders.map((header) => (
                                  <option key={header} value={header}>
                                    {header}
                                  </option>
                                ))}
                              </select>
                            )}
                            {field !== 'assetClass' && FIELD_HINTS[field] && (
                              <div
                                className="text-muted"
                                style={{
                                  fontSize: '10px',
                                  fontWeight: 400,
                                  textTransform: 'none',
                                  letterSpacing: 'normal',
                                  marginTop: '4px',
                                  whiteSpace: 'normal',
                                }}
                              >
                                {FIELD_HINTS[field]}
                              </div>
                            )}
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
                              background: hasRowError ? 'rgba(138, 60, 46, 0.06)' : 'transparent',
                            }}
                          >
                            <td style={{ padding: '6px 4px', verticalAlign: 'top' }}>
                              <button
                                type="button"
                                className="btn-icon"
                                onClick={() => handleDeleteRow(rowIdx)}
                                title="Delete this row"
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
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.color = 'var(--color-text-secondary)')
                                }
                              >
                                <Trash size={14} />
                              </button>
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
                                <td key={field} style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                                  <input
                                    type="text"
                                    className="input"
                                    value={cellValue}
                                    style={
                                      cellHasError
                                        ? { borderColor: '#8a3c2e' }
                                        : undefined
                                    }
                                    onChange={(e) => {
                                      setImportEdits((prev) => ({
                                        ...prev,
                                        [rowIdx]: {
                                          ...prev[rowIdx],
                                          [field]: e.target.value,
                                        },
                                      }))
                                      if (field === 'assetClass') {
                                        setTouchedAssetClassRows((prev) => new Set(prev).add(rowIdx))
                                      }
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
              </>
            )}

            <div className="dialog-actions">
              {!importDone && (
                <button type="button" className="btn btn-secondary blueprint" onClick={handleBack}>
                  <i className="corner tl"></i>
                  <i className="corner tr"></i>
                  <i className="corner bl"></i>
                  <i className="corner br"></i>
                  Back
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={handlePrimary}
                disabled={
                  importDone
                    ? false
                    : (entryMode === 'upload' && !isReviewValid(dataType, fieldMap)) ||
                      hasImportErrors ||
                      hasNoValidManualRows ||
                      previewRows.length === 0 ||
                      (dataType === 'positions' && !assetClassHeaderValue.trim())
                }
              >
                {importDone ? 'Done' : 'Import'}
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </>
  )
}
