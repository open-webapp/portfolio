import { useCallback, useState } from 'react'
import type { AppState } from '../lib/state'
import type { BalanceEntry } from '../lib/types'
import {
  ACTIVITY_TYPES,
  BALANCE_FIELD_HINTS,
  emptyDraftRow,
  isDraftRowValid,
  matchAccountId,
  matchActivityType,
  normalizeDateInput,
  type DraftActivity,
  type DraftRow,
} from '../lib/register'
import { tableToCsv, type PastedClipboard } from '../lib/pastedTable'
import { uid } from '../lib/seed'

export interface RegisterBalanceDialogProps {
  state: AppState
  dispatch: (action: any) => void
  onClose: () => void
  editingEntry?: BalanceEntry
}

const todayLocal = (): string => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

/** Build a single-row draft (with fresh local activity keys) from an existing BalanceEntry,
 * for the "edit" flow of RegisterBalanceDialog. */
function draftRowFromEntry(entry: BalanceEntry): DraftRow {
  return {
    key: uid('brow'),
    date: entry.date,
    accountId: entry.accountId,
    balance: String(entry.balance),
    activities: entry.activities.map((a) => ({
      key: uid('bact'),
      type: a.type,
      amount: String(a.amount),
      note: a.note,
    })),
  }
}

/** Map a pasted-table field key to the DraftRow field it corresponds to, running the
 * appropriate normalizer for that field. */
function cellToDraftField(
  fieldKey: string,
  rawValue: string,
  accounts: AppState['accounts'],
  draft: DraftRow,
): Partial<DraftRow> {
  switch (fieldKey) {
    case 'date':
      return { date: normalizeDateInput(rawValue) }
    case 'accountId':
      return { accountId: matchAccountId(rawValue, accounts) }
    case 'balance':
      return { balance: rawValue.trim() }
    case 'activityType':
    case 'activityAmount':
    case 'note': {
      // Paste stays single-activity: merge onto the row's one (possibly not-yet-created)
      // activity rather than extending to a multi-activity paste format.
      const existing: DraftActivity = draft.activities[0] ?? { key: uid('bact'), type: 'None', amount: '', note: '' }
      const updated: DraftActivity = { ...existing }
      if (fieldKey === 'activityType') updated.type = matchActivityType(rawValue)
      if (fieldKey === 'activityAmount') updated.amount = rawValue.trim()
      if (fieldKey === 'note') updated.note = rawValue.trim()
      return { activities: [updated] }
    }
    default:
      return {}
  }
}

/** Map pasted headers to BALANCE_FIELD_HINTS keys: exact key match first, then hint
 * substring match (case-insensitive), mirroring the design mock's rebuildBalPaste(). */
function mapPastedHeaders(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  headers.forEach((header) => {
    const h = header.trim().toLowerCase()
    let matched = BALANCE_FIELD_HINTS.find((f) => f.key.toLowerCase() === h)
    if (!matched) {
      matched = BALANCE_FIELD_HINTS.find((f) => f.hints.some((hint) => h.includes(hint)))
    }
    if (matched) map[header] = matched.key
  })
  return map
}

/**
 * RegisterBalanceDialog: "Record Balances" dialog for RegisterPage. Two modes — manual
 * entry (editable draft-row table) and copy-paste (headers + values paste zones parsed
 * via tableToCsv and mapped to fields via BALANCE_FIELD_HINTS). Save dispatches
 * ADD_BALANCE_ENTRIES with valid rows only; local draft state is discarded on Cancel.
 */
export function RegisterBalanceDialog({ state, dispatch, onClose, editingEntry }: RegisterBalanceDialogProps) {
  const [mode, setMode] = useState<'manual' | 'paste'>('manual')
  const [rows, setRows] = useState<DraftRow[]>(() =>
    editingEntry
      ? [draftRowFromEntry(editingEntry)]
      : [{ ...emptyDraftRow(), date: todayLocal(), accountId: state.regAccountId ?? '' }],
  )
  const [pasteHeaderText, setPasteHeaderText] = useState('')
  const [pasteValuesText, setPasteValuesText] = useState('')
  const [parseError, setParseError] = useState('')

  const resetAndClose = useCallback(() => {
    setMode('manual')
    setRows(
      editingEntry
        ? [draftRowFromEntry(editingEntry)]
        : [{ ...emptyDraftRow(), date: todayLocal(), accountId: state.regAccountId ?? '' }],
    )
    setPasteHeaderText('')
    setPasteValuesText('')
    setParseError('')
    onClose()
  }, [onClose, state.regAccountId, editingEntry])

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key))
  }

  const addRow = () => {
    setRows((prev) => [...prev, emptyDraftRow()])
  }

  const addActivity = (rowKey: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.key === rowKey
          ? { ...r, activities: [...r.activities, { key: uid('bact'), type: 'None', amount: '', note: '' }] }
          : r,
      ),
    )
  }

  const updateActivity = (rowKey: string, activityKey: string, patch: Partial<DraftActivity>) => {
    setRows((prev) =>
      prev.map((r) =>
        r.key === rowKey
          ? { ...r, activities: r.activities.map((a) => (a.key === activityKey ? { ...a, ...patch } : a)) }
          : r,
      ),
    )
  }

  const removeActivity = (rowKey: string, activityKey: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.key === rowKey ? { ...r, activities: r.activities.filter((a) => a.key !== activityKey) } : r,
      ),
    )
  }

  const rebuildPaste = useCallback((headerText: string, valuesText: string) => {
    if (!headerText.trim() || !valuesText.trim()) {
      setParseError('Paste both a header row and at least one data row.')
      setRows([])
      return
    }
    const headersClip: PastedClipboard = { text: headerText }
    const valuesClip: PastedClipboard = { text: valuesText }
    const parsed = tableToCsv(headersClip, valuesClip)
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setParseError('Could not parse the pasted data. Make sure headers and values are both present.')
      setRows([])
      return
    }
    setParseError('')
    const headerFieldMap = mapPastedHeaders(parsed.headers)
    const draftRows: DraftRow[] = parsed.rows.map((row) => {
      const draft = emptyDraftRow()
      for (const [header, fieldKey] of Object.entries(headerFieldMap)) {
        Object.assign(draft, cellToDraftField(fieldKey, row[header] ?? '', state.accounts, draft))
      }
      return draft
    })
    setRows(draftRows)
  }, [state.accounts])

  const handlePasteHeaders = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    setPasteHeaderText(text)
    rebuildPaste(text, pasteValuesText)
  }

  const handlePasteValues = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    setPasteValuesText(text)
    rebuildPaste(pasteHeaderText, text)
  }

  const validRows = rows.filter(isDraftRowValid)

  const draftRowToActivities = (r: DraftRow) =>
    r.activities.map((a) => ({
      type: matchActivityType(a.type) || 'None',
      amount: Math.abs(parseFloat(a.amount)) || 0,
      note: a.note,
    }))

  const handleSave = () => {
    if (validRows.length === 0) return
    if (editingEntry) {
      const r = validRows[0]
      const entry: BalanceEntry = {
        id: editingEntry.id,
        accountId: r.accountId,
        date: r.date,
        balance: parseFloat(r.balance),
        activities: draftRowToActivities(r),
      }
      dispatch({ type: 'UPDATE_BALANCE_ENTRY', entry })
      resetAndClose()
      return
    }
    const entries: BalanceEntry[] = validRows.map((r) => ({
      id: uid('bal'),
      accountId: r.accountId,
      date: r.date,
      balance: parseFloat(r.balance),
      activities: draftRowToActivities(r),
    }))
    dispatch({ type: 'ADD_BALANCE_ENTRIES', entries })
    resetAndClose()
  }

  const handleDelete = () => {
    if (!editingEntry) return
    const confirmed = window.confirm('Delete this balance entry? This cannot be undone.')
    if (confirmed) {
      dispatch({ type: 'DELETE_BALANCE_ENTRY', id: editingEntry.id })
      onClose()
    }
  }

  return (
    <div className="dialog-backdrop" onClick={resetAndClose} style={{ zIndex: 1000 }}>
      <div
        className="dialog blueprint"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(96vw, 900px)',
          maxWidth: '96vw',
          maxHeight: '88vh',
          overflow: 'auto',
          background: 'var(--color-bg)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="dialog-title">Record Balances</div>
          <button
            type="button"
            onClick={resetAndClose}
            aria-label="Close"
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text)', opacity: 0.6, padding: '4px' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M18 6 6 18"></path>
              <path d="m6 6 12 12"></path>
            </svg>
          </button>
        </div>

        {!editingEntry && (
          <div className="seg" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', width: '100%', marginBottom: 'var(--space-4)' }}>
            <label className="seg-opt">
              <input type="radio" name="regBalMode" checked={mode === 'manual'} onChange={() => setMode('manual')} />
              <span>Enter manually</span>
            </label>
            <label className="seg-opt">
              <input type="radio" name="regBalMode" checked={mode === 'paste'} onChange={() => setMode('paste')} />
              <span>Copy-Paste</span>
            </label>
          </div>
        )}

        {mode === 'paste' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
            <div className="field">
              <label>Headers</label>
              <div
                tabIndex={0}
                onPaste={handlePasteHeaders}
                onClick={(e) => e.currentTarget.focus()}
                data-testid="bal-paste-headers-zone"
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
                <div>{pasteHeaderText ? 'Headers pasted — click to replace' : 'Click here and press Ctrl+V / ⌘V'}</div>
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
                data-testid="bal-paste-values-zone"
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
                <div>{pasteValuesText ? 'Values pasted — click to replace' : 'Click here and press Ctrl+V / ⌘V'}</div>
                <div className="text-muted" style={{ fontSize: '11px', marginTop: '4px' }}>
                  Paste the data rows (no header row)
                </div>
              </div>
            </div>
            {parseError && (
              <div style={{ gridColumn: '1 / -1', color: '#8a3c2e', fontSize: '12px' }}>{parseError}</div>
            )}
          </div>
        )}

        <div style={{ maxHeight: '360px', overflow: 'auto', border: '1px solid var(--color-divider)' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Account</th>
                <th>Balance</th>
                <th>Activity</th>
                <th>Amount</th>
                <th>Note</th>
                <th style={{ width: '32px' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const valid = isDraftRowValid(row)
                return (
                  <tr key={row.key}>
                    <td>
                      <input
                        type="date"
                        className="input"
                        value={row.date}
                        style={!valid && !row.date ? { borderColor: '#8a3c2e' } : undefined}
                        onChange={(e) => updateRow(row.key, { date: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="input"
                        value={row.accountId}
                        style={!valid && !row.accountId ? { borderColor: '#8a3c2e' } : undefined}
                        onChange={(e) => updateRow(row.key, { accountId: e.target.value })}
                      >
                        <option value="">— Select account —</option>
                        {state.accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.institution} — {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        className="input"
                        value={row.balance}
                        style={!valid && (row.balance === '' || isNaN(parseFloat(row.balance))) ? { borderColor: '#8a3c2e' } : undefined}
                        onChange={(e) => updateRow(row.key, { balance: e.target.value })}
                        placeholder="e.g. 12500.00"
                      />
                    </td>
                    <td colSpan={3}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        {row.activities.map((activity) => (
                          <div
                            key={activity.key}
                            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 'var(--space-2)', alignItems: 'center' }}
                          >
                            <select
                              className="input"
                              value={activity.type}
                              onChange={(e) => updateActivity(row.key, activity.key, { type: e.target.value })}
                            >
                              {ACTIVITY_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                            <input
                              type="text"
                              className="input"
                              value={activity.amount}
                              onChange={(e) => updateActivity(row.key, activity.key, { amount: e.target.value })}
                              placeholder="0.00"
                            />
                            <input
                              type="text"
                              className="input"
                              value={activity.note}
                              onChange={(e) => updateActivity(row.key, activity.key, { note: e.target.value })}
                              placeholder="Note"
                            />
                            <button
                              type="button"
                              className="btn-icon"
                              title="Remove activity"
                              onClick={() => removeActivity(row.key, activity.key)}
                              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text)', opacity: 0.6, padding: '4px' }}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                                <path d="M18 6 6 18"></path>
                                <path d="m6 6 12 12"></path>
                              </svg>
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="btn btn-secondary blueprint"
                          onClick={() => addActivity(row.key)}
                          style={{ alignSelf: 'flex-start', fontSize: '11px', padding: '2px 8px' }}
                        >
                          + Add activity
                        </button>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn-icon"
                        title="Remove row"
                        onClick={() => removeRow(row.key)}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text)', opacity: 0.6, padding: '4px' }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
                          <path d="M18 6 6 18"></path>
                          <path d="m6 6 12 12"></path>
                        </svg>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {mode === 'manual' && !editingEntry && (
          <button type="button" className="btn btn-secondary blueprint" onClick={addRow} style={{ alignSelf: 'flex-start' }}>
            + Add row
          </button>
        )}

        <div className="dialog-actions">
          {editingEntry && (
            <button
              type="button"
              className="btn btn-secondary blueprint"
              onClick={handleDelete}
              style={{ color: '#8a3c2e', marginRight: 'auto' }}
            >
              Delete
            </button>
          )}
          <button type="button" className="btn btn-secondary blueprint" onClick={resetAndClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={validRows.length === 0} onClick={handleSave}>
            {editingEntry ? 'Save changes' : `Save ${validRows.length} ${validRows.length === 1 ? 'entry' : 'entries'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default RegisterBalanceDialog
