import { useCallback, useState } from 'react'
import type { AppState } from '../../lib/state'
import type { TaxCategory } from '../../lib/types'

export interface AccountResolvePromptProps {
  state: AppState
  dispatch: (action: any) => void
}

/**
 * AccountResolvePrompt: Modal dialog that appears when importing data for a
 * first-seen account number. Prompts user to name the account, choose its tax
 * category, and mark whether it's a retirement account.
 *
 * Renders one account at a time from state.accountPromptQueue. After finalization,
 * the import effect re-runs and processes the next account in the queue (if any).
 */
export function AccountResolvePrompt({ state, dispatch }: AccountResolvePromptProps) {
  const [name, setName] = useState('')
  const [taxCategory, setTaxCategory] = useState<TaxCategory>('taxable')
  const [retirement, setRetirement] = useState(false)

  const current = state.accountPromptQueue?.[0]
  if (!current) {
    return null
  }

  const handleSubmit = useCallback(() => {
    if (!name.trim()) {
      alert('Please enter an account name')
      return
    }

    // Finalize the new account with user-provided details
    dispatch({
      type: 'FINALIZE_NEW_ACCOUNT',
      accountNumber: current.accountNumber,
      name: name.trim(),
      taxCategory,
      retirement,
    })

    // Reset form for next account (if any)
    setName('')
    setTaxCategory('taxable')
    setRetirement(false)
  }, [name, taxCategory, retirement, current, dispatch])

  const handleCancel = useCallback(() => {
    // Clear the entire import flow on cancel
    dispatch({ type: 'SET_PENDING_IMPORT', pendingImport: undefined })
    dispatch({ type: 'SET_ACCOUNT_PROMPT_QUEUE', accountPromptQueue: undefined })
    setName('')
    setTaxCategory('taxable')
    setRetirement(false)
  }, [dispatch])

  return (
    <>
      {/* Modal backdrop */}
      <div
        onClick={handleCancel}
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
          maxWidth: '500px',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        }}
      >
        <h2>Create New Account</h2>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
          The account <strong>{current.accountNumber}</strong> does not exist yet. Please provide
          details to create it.
        </p>

        {/* Account Name */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
            Account Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Fidelity Brokerage"
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid var(--color-divider)',
              borderRadius: '4px',
              fontSize: '14px',
              boxSizing: 'border-box',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
            }}
          />
        </div>

        {/* Tax Category */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
            Tax Category
          </label>
          <select
            value={taxCategory}
            onChange={(e) => setTaxCategory(e.target.value as TaxCategory)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid var(--color-divider)',
              borderRadius: '4px',
              fontSize: '14px',
              boxSizing: 'border-box',
            }}
          >
            <option value="taxable">Taxable</option>
            <option value="nonTaxable">Non-Taxable</option>
            <option value="taxDeferred">Tax-Deferred</option>
          </select>
        </div>

        {/* Retirement Checkbox */}
        <div style={{ marginBottom: 'var(--space-6)', display: 'flex', alignItems: 'center' }}>
          <input
            type="checkbox"
            id="retirement-check"
            checked={retirement}
            onChange={(e) => setRetirement(e.target.checked)}
            style={{ marginRight: '8px', cursor: 'pointer' }}
          />
          <label htmlFor="retirement-check" style={{ cursor: 'pointer' }}>
            This is a retirement account
          </label>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={handleCancel}
            style={{
              padding: '8px 16px',
              borderRadius: '4px',
              border: '1px solid var(--color-divider)',
              background: 'var(--color-surface)',
              cursor: 'pointer',
            }}
          >
            Cancel Import
          </button>
          <button
            onClick={handleSubmit}
            style={{
              padding: '8px 16px',
              borderRadius: '4px',
              border: 'none',
              background: 'var(--color-accent)',
              color: 'var(--color-bg)',
              cursor: 'pointer',
            }}
          >
            Create Account & Continue
          </button>
        </div>
      </div>
    </>
  )
}
