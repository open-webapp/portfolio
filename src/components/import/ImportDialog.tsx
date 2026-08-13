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
import { tableToCsv, type PastedClipboard, type CsvIssue } from '../../lib/pastedTable'

export interface ImportDialogProps {
  state: AppState
  dispatch: (action: any) => void
  onClose: () => void
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
  const [entryMode, setEntryMode] = useState<'upload' | 'paste' | 'manual'>('upload')
  const [importAccountKey, setImportAccountKey] = useState<string>('')
  const [formInstitution, setFormInstitution] = useState<string>('')
  const [formName, setFormName] = useState<string>('')
  const [formNumber, setFormNumber] = useState<string>('')
  const [formCategory, setFormCategory] = useState<TaxCategory>('taxable')
  const [formRetirement, setFormRetirement] = useState<'retirement' | 'nonRetirement'>('nonRetirement')
  const [isAddingInstitution, setIsAddingInstitution] = useState(false)
  const [newInstitutionName, setNewInstitutionName] = useState('')
  const [importSaved, setImportSaved] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [fileError, setFileError] = useState<string>('')
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([])
  const [pasteHeaderClipboard, setPasteHeaderClipboard] = useState<PastedClipboard>({})
  const [pasteValuesClipboard, setPasteValuesClipboard] = useState<PastedClipboard>({})
  const [pasteIssues, setPasteIssues] = useState<CsvIssue[]>([])
  void pasteIssues // Keep TypeScript happy; will be used to display paste issues in future tasks

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
    setImportAccountKey('')
    setFormInstitution('')
    setFormName('')
    setFormNumber('')
    setFormCategory('taxable')
    setFormRetirement('nonRetirement')
    setIsAddingInstitution(false)
    setNewInstitutionName('')
    setImportSaved(false)
    setFile(null)
    setFileName('')
    setFileError('')
    setCsvHeaders([])
    setCsvRows([])
    setPasteHeaderClipboard({})
    setPasteValuesClipboard({})
    setPasteIssues([])
    setFieldMap({})
    setImportEdits({})
    setImportDone(false)
    setImportedRowCount(0)
    setAssetClassHeaderValue('')
    setTouchedAssetClassRows(new Set())
    onClose()
  }, [onClose])

  const handleAccountKeyChange = useCallback(
    (key: string) => {
      setImportAccountKey(key)
      setImportSaved(false)
      if (key === '__new__') {
        setFormInstitution('')
        setFormName('')
        setFormNumber('')
        setFormCategory('taxable')
        setFormRetirement('nonRetirement')
      } else {
        const a = state.accounts.find((acc) => acc.id === key)
        if (!a) return
        setFormInstitution(a.institution || '')
        setFormName(a.name)
        setFormNumber(a.accountNumber || '')
        setFormCategory(a.taxCategory)
        setFormRetirement(a.retirement ? 'retirement' : 'nonRetirement')
      }
    },
    [state.accounts]
  )

  const updateFormField = useCallback(
    (updater: () => void) => {
      updater()
      setImportSaved(false)
    },
    []
  )

  const selectedAccount =
    importAccountKey !== '__new__'
      ? state.accounts.find((a) => a.id === importAccountKey)
      : undefined
  const isExistingAccountSelected = importAccountKey !== '' && importAccountKey !== '__new__'
  const saveDisabled =
    !isExistingAccountSelected ||
    !selectedAccount ||
    (formInstitution === (selectedAccount.institution || '') &&
      formName.trim() === selectedAccount.name &&
      formNumber.trim() === (selectedAccount.accountNumber || '') &&
      formCategory === selectedAccount.taxCategory &&
      formRetirement === (selectedAccount.retirement ? 'retirement' : 'nonRetirement'))

  const handleSaveAccountChanges = useCallback(() => {
    if (!selectedAccount) return
    const patch: Partial<Account> = {}
    if (formInstitution !== (selectedAccount.institution || ''))
      patch.institution = formInstitution
    if (formName.trim() !== selectedAccount.name) patch.name = formName.trim()
    if (formNumber.trim() !== (selectedAccount.accountNumber || ''))
      patch.accountNumber = formNumber.trim()
    if (formCategory !== selectedAccount.taxCategory) patch.taxCategory = formCategory
    const retirementBool = formRetirement === 'retirement'
    if (retirementBool !== selectedAccount.retirement) patch.retirement = retirementBool
    if (Object.keys(patch).length === 0) return
    dispatch({ type: 'UPDATE_ACCOUNT', accountId: selectedAccount.id, patch })
    setImportSaved(true)
  }, [selectedAccount, formInstitution, formName, formNumber, formCategory, formRetirement, dispatch])

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

  const resetPasteState = useCallback(() => {
    setPasteHeaderClipboard({})
    setPasteValuesClipboard({})
    setPasteIssues([])
    setCsvHeaders([])
    setCsvRows([])
  }, [])

  const handlePasteHeaders = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault()
      const clip: PastedClipboard = {
        html: e.clipboardData.getData('text/html'),
        text: e.clipboardData.getData('text/plain'),
      }
      setPasteHeaderClipboard(clip)
      const result = tableToCsv(clip, pasteValuesClipboard)
      setCsvHeaders(result.headers)
      setCsvRows(result.rows)
      setPasteIssues(result.issues)
    },
    [pasteValuesClipboard]
  )

  const handlePasteValues = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault()
      const clip: PastedClipboard = {
        html: e.clipboardData.getData('text/html'),
        text: e.clipboardData.getData('text/plain'),
      }
      setPasteValuesClipboard(clip)
      const result = tableToCsv(pasteHeaderClipboard, clip)
      setCsvHeaders(result.headers)
      setCsvRows(result.rows)
      setPasteIssues(result.issues)
    },
    [pasteHeaderClipboard]
  )


  const isStep1Complete = (): boolean => {
    const isExisting = importAccountKey !== '' && importAccountKey !== '__new__'
    const accountResolved = isExisting ? true : formName.trim() !== '' && formNumber.trim() !== ''
    const fileSelected =
      entryMode === 'manual' ||
      (entryMode === 'upload' && file !== null && csvRows.length > 0) ||
      (entryMode === 'paste' && csvHeaders.length > 0 && csvRows.length > 0)
    return accountResolved && fileSelected
  }

  const handleContinue = useCallback(() => {
    if (step === 1) {
      if (!isStep1Complete()) return

      if (entryMode === 'manual') {
        setCsvRows(Array.from({ length: 10 }, () => ({})))
      } else {
        // Prefill fieldMap from saved mapping if importing to existing account
        if (importAccountKey !== '' && importAccountKey !== '__new__') {
          const saved = state.csvMappings.find(
            (m) => m.accountId === importAccountKey && m.kind === dataType
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
  }, [step, isStep1Complete, entryMode, importAccountKey, dataType, csvHeaders, state.csvMappings])

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
    let accountId = importAccountKey

    // If new account mode, create the account first
    if (importAccountKey === '__new__') {
      const newAccount: Account = {
        id: uid('acc'),
        accountNumber: formNumber.trim(),
        name: formName.trim(),
        institution: formInstitution,
        taxCategory: formCategory,
        retirement: formRetirement === 'retirement',
        createdAt: new Date().toISOString(),
      }
      accountId = newAccount.id
      dispatch({ type: 'ADD_ACCOUNT', account: newAccount })
    }

    // Dispatch the import action
    if (dataType === 'positions') {
      dispatch({
        type: 'IMPORT_POSITIONS',
        accountId,
        mappedRows: finalRows,
        importDate: new Date().toISOString(),
        fileName,
        // Manual entry and Copy-Paste are inherently partial batches (the user isn't
        // re-supplying their whole account), so upsert by symbol instead of replacing
        // the account's entire position list. Upload keeps replace semantics (a CSV
        // export is expected to be the full, authoritative snapshot).
        mode: entryMode === 'upload' ? 'replace' : 'merge',
      })
    } else {
      dispatch({
        type: 'IMPORT_TRANSACTIONS',
        accountId,
        mappedRows: finalRows,
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
    importAccountKey,
    entryMode,
    formName,
    formNumber,
    formInstitution,
    formCategory,
    formRetirement,
    dispatch,
    fileName,
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
      <button type="button" className="btn btn-secondary blueprint" onClick={handleOpenDialog} aria-label="Accounts & Import">
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
        Accounts & Import
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

  const destinationAccountForStep2 =
    importAccountKey !== '' && importAccountKey !== '__new__'
      ? state.accounts.find((a) => a.id === importAccountKey)
      : null
  const accountLabel =
    importAccountKey !== '' && importAccountKey !== '__new__'
      ? destinationAccountForStep2
        ? destinationAccountForStep2.name +
          (destinationAccountForStep2.accountNumber
            ? ` • #${destinationAccountForStep2.accountNumber}`
            : '')
        : ''
      : formName
  const categoryLabel =
    importAccountKey !== '' && importAccountKey !== '__new__'
      ? destinationAccountForStep2
        ? TAX_CATEGORY_LABELS[destinationAccountForStep2.taxCategory]
        : ''
      : TAX_CATEGORY_LABELS[formCategory]

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
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 'var(--space-6)',
                alignItems: 'start',
              }}
            >
              {/* LEFT COLUMN */}
              <div>
                {/* Account select */}
                <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
                  <label>Account</label>
                  <select
                    className="input"
                    value={importAccountKey}
                    onChange={(e) => handleAccountKeyChange(e.target.value)}
                  >
                    <option value="">-- Select an account --</option>
                    {state.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.accountNumber ? ` • #${a.accountNumber}` : ''}
                        {a.institution ? ` — ${a.institution}` : ''}
                      </option>
                    ))}
                    <option value="__new__">+ Add new account…</option>
                  </select>
                </div>

                {/* Institution field */}
                <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
                  <label>Institution</label>
                  {(() => {
                    const SEED_INSTITUTIONS = ['Fidelity', 'Charles Schwab', 'Vanguard']
                    const inUseInstitutions = Array.from(
                      new Set(
                        state.accounts
                          .map((a) => a.institution || '')
                          .filter((i) => i !== '')
                      )
                    )
                    const seedSet = new Set(SEED_INSTITUTIONS)
                    const extraInstitutions = Array.from(
                      new Set([...state.customInstitutions, ...inUseInstitutions])
                    )
                      .filter((i) => !seedSet.has(i))
                      .sort()
                    const institutionOptions = [...SEED_INSTITUTIONS, ...extraInstitutions]

                    return isAddingInstitution ? (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <input
                          className="input"
                          placeholder="e.g. Ally Invest"
                          value={newInstitutionName}
                          onChange={(e) => setNewInstitutionName(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn btn-primary blueprint"
                          disabled={!newInstitutionName.trim()}
                          onClick={() => {
                            const name = newInstitutionName.trim()
                            if (!name) return
                            if (!state.customInstitutions.includes(name)) {
                              dispatch({ type: 'ADD_CUSTOM_INSTITUTION', name })
                            }
                            setFormInstitution(name)
                            setImportSaved(false)
                            setIsAddingInstitution(false)
                            setNewInstitutionName('')
                          }}
                        >
                          <i className="corner tl"></i>
                          <i className="corner tr"></i>
                          <i className="corner bl"></i>
                          <i className="corner br"></i>
                          Add
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary blueprint"
                          onClick={() => {
                            setIsAddingInstitution(false)
                            setNewInstitutionName('')
                          }}
                        >
                          <i className="corner tl"></i>
                          <i className="corner tr"></i>
                          <i className="corner bl"></i>
                          <i className="corner br"></i>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <select
                        className="input"
                        value={formInstitution}
                        onChange={(e) => {
                          if (e.target.value === '__add_new__') {
                            setIsAddingInstitution(true)
                            setNewInstitutionName('')
                            return
                          }
                          updateFormField(() => setFormInstitution(e.target.value))
                        }}
                      >
                        {formInstitution === '' && <option value="">-- Select --</option>}
                        {institutionOptions.map((i) => (
                          <option key={i} value={i}>
                            {i}
                          </option>
                        ))}
                        <option value="__add_new__">+ Add new institution…</option>
                      </select>
                    )
                  })()}
                </div>

                {/* Account name and Account number grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 'var(--space-3)',
                    marginBottom: 'var(--space-4)',
                  }}
                >
                  <div className="field">
                    <label>Account name</label>
                    <input
                      type="text"
                      className="input"
                      value={formName}
                      onChange={(e) => updateFormField(() => setFormName(e.target.value))}
                      placeholder="e.g. Fidelity Rollover IRA"
                    />
                  </div>
                  <div className="field">
                    <label>Account number</label>
                    <input
                      type="text"
                      className="input"
                      value={formNumber}
                      onChange={(e) => updateFormField(() => setFormNumber(e.target.value))}
                      placeholder="e.g. 8842-1190"
                    />
                  </div>
                </div>

                {/* Category and Retirement grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 'var(--space-3)',
                  }}
                >
                  <div className="field">
                    <label>Category</label>
                    <select
                      className="input"
                      value={formCategory}
                      onChange={(e) =>
                        updateFormField(() => setFormCategory(e.target.value as TaxCategory))
                      }
                    >
                      <option value="taxable">Taxable</option>
                      <option value="nonTaxable">Non-Taxable</option>
                      <option value="taxDeferred">Tax-Deferred</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Retirement</label>
                    <select
                      className="input"
                      value={formRetirement}
                      onChange={(e) => {
                        updateFormField(() =>
                          setFormRetirement(e.target.value as 'retirement' | 'nonRetirement')
                        )
                      }}
                    >
                      <option value="retirement">Retirement</option>
                      <option value="nonRetirement">Non-Retirement</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN */}
              <div>
                {/* Data type seg */}
                <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
                  <label>What are you importing?</label>
                  <div
                    className="seg"
                    style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', width: '100%' }}
                  >
                    <label className="seg-opt">
                      <input
                        type="radio"
                        name="importDataType"
                        checked={dataType === 'transactions'}
                        onChange={() => {
                          resetPasteState()
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

                {/* Entry mode seg (positions-only) */}
                {dataType === 'positions' && (
                  <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
                    <label>How will you add the data?</label>
                    <div
                      className="seg"
                      style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', width: '100%' }}
                    >
                      <label className="seg-opt">
                        <input
                          type="radio"
                          name="importEntryMode"
                          checked={entryMode === 'upload'}
                          onChange={() => {
                            resetPasteState()
                            setEntryMode('upload')
                          }}
                        />
                        <span>Upload CSV file</span>
                      </label>
                      <label className="seg-opt">
                        <input
                          type="radio"
                          name="importEntryMode"
                          checked={entryMode === 'paste'}
                          onChange={() => {
                            resetPasteState()
                            setEntryMode('paste')
                          }}
                        />
                        <span>Copy-Paste</span>
                      </label>
                      <label className="seg-opt">
                        <input
                          type="radio"
                          name="importEntryMode"
                          checked={entryMode === 'manual'}
                          onChange={() => {
                            resetPasteState()
                            setEntryMode('manual')
                          }}
                        />
                        <span>Enter manually</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* CSV dropzone */}
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
                        style={{
                          color: 'var(--color-accent)',
                          marginBottom: '8px',
                        }}
                      >
                        <path d="M12 3v12"></path>
                        <path d="m7 8 5-5 5 5"></path>
                        <path d="M5 21h14"></path>
                      </svg>
                      <div>{file ? file.name : 'No file selected'}</div>
                      <div
                        className="text-muted"
                        style={{ fontSize: '11px', marginTop: '4px' }}
                      >
                        Drag and drop, or click to browse
                      </div>
                    </div>
                    {fileError && (
                      <div
                        style={{
                          color: '#8a3c2e',
                          fontSize: '12px',
                          marginTop: '6px',
                        }}
                      >
                        {fileError}
                      </div>
                    )}
                  </div>
                )}

                {/* Paste zones */}
                {entryMode === 'paste' && (
                  <>
                    <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
                      <label>Headers</label>
                      <div
                        tabIndex={0}
                        onPaste={handlePasteHeaders}
                        onClick={(e) => e.currentTarget.focus()}
                        data-testid="paste-headers-zone"
                        style={{
                          border: '2px dashed var(--color-divider)',
                          borderRadius: '4px',
                          background: 'var(--color-surface)',
                          padding: 'var(--space-4)',
                          minHeight: '90px',
                          textAlign: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <div>
                          {csvHeaders.length > 0
                            ? `${csvHeaders.length} columns pasted — click to replace`
                            : 'Click here and press Ctrl+V / ⌘V'}
                        </div>
                        <div className="text-muted" style={{ fontSize: '11px', marginTop: '4px' }}>
                          Paste the single row of column names
                        </div>
                      </div>
                    </div>

                    <div className="field">
                      <label>Values</label>
                      <div
                        tabIndex={0}
                        onPaste={handlePasteValues}
                        onClick={(e) => e.currentTarget.focus()}
                        data-testid="paste-values-zone"
                        style={{
                          border: '2px dashed var(--color-divider)',
                          borderRadius: '4px',
                          background: 'var(--color-surface)',
                          padding: 'var(--space-4)',
                          minHeight: '140px',
                          textAlign: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <div>
                          {csvRows.length > 0
                            ? `${csvRows.length} rows pasted — click to replace`
                            : 'Click here and press Ctrl+V / ⌘V'}
                        </div>
                        <div className="text-muted" style={{ fontSize: '11px', marginTop: '4px' }}>
                          Paste the data rows (no header row)
                        </div>
                      </div>
                      {pasteIssues.length > 0 && (
                        <div
                          style={{
                            color: '#8a3c2e',
                            fontSize: '12px',
                            marginTop: '6px',
                          }}
                        >
                          {pasteIssues.length} row(s) had an unexpected number of columns and were adjusted
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Manual entry hint */}
                {dataType === 'positions' && entryMode === 'manual' && (
                  <div className="text-muted" style={{ fontSize: '12px' }}>
                    You'll enter each row's data directly on the next screen.
                  </div>
                )}
              </div>
            </div>

            {/* Dialog actions */}
            <div className="dialog-actions">
              {isExistingAccountSelected && (
                <button
                  type="button"
                  className="btn btn-secondary blueprint"
                  style={{ marginRight: 'auto' }}
                  disabled={saveDisabled}
                  onClick={handleSaveAccountChanges}
                >
                  <i className="corner tl"></i>
                  <i className="corner tr"></i>
                  <i className="corner bl"></i>
                  <i className="corner br"></i>
                  {importSaved ? 'Saved' : 'Save'}
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary blueprint"
                onClick={handleContinue}
                disabled={!isStep1Complete()}
              >
                <i className="corner tl"></i>
                <i className="corner tr"></i>
                <i className="corner bl"></i>
                <i className="corner br"></i>
                Continue
              </button>
            </div>
          </>
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

export default ImportDialog
