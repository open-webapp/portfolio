import { useCallback, useMemo } from 'react'
import type { AppState } from '../lib/state'
import { visibleTransactions } from '../lib/selectors'
import { fmtUSD } from '../lib/computations'

export interface TransactionsTableProps {
  state: AppState
  dispatch: (action: any) => void
}

/**
 * TransactionsTable component: displays filtered transactions with type filter, search,
 * and unmatched badge for transactions without matching open positions.
 * Per .dc.html lines 208-250 and unmatched detection logic from line 537.
 */
export function TransactionsTable({ state, dispatch }: TransactionsTableProps) {
  const transactions = useMemo(() => visibleTransactions(state), [state])

  // Get unique transaction types for filter tags
  const transactionTypes = useMemo(() => {
    const types = new Set(state.transactions.map((t) => t.type))
    return ['All', ...Array.from(types).sort()]
  }, [state.transactions])

  // Build a set of held symbols (symbols in open positions for accounts in selected category)
  const heldSymbols = useMemo(() => {
    const accountsInCategory = state.accounts.filter((a) => {
      if (state.category === 'all') return true
      return a.taxCategory === state.category
    })
    const accountIds = new Set(accountsInCategory.map((a) => a.id))

    return new Set(
      state.positions
        .filter((p) => accountIds.has(p.accountId))
        .map((p) => p.symbol)
    )
  }, [state.accounts, state.positions, state.category])

  const handleTypeFilterClick = useCallback(
    (type: string) => {
      dispatch({
        type: 'SET_TRANSACTION_TYPE_FILTER',
        filter: state.txTypeFilter === type ? 'All' : type,
      })
    },
    [dispatch, state.txTypeFilter]
  )

  const handleTxSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      dispatch({
        type: 'SET_TRANSACTIONS_SEARCH',
        search: e.target.value,
      })
    },
    [dispatch]
  )

  // Determine tag class for each transaction type
  const txTagClass: Record<string, string> = {
    'Buy': 'tag-accent',
    'Sell': 'tag-outline',
    'Dividend': 'tag-neutral',
  }

  // Compute rendered transaction data with unmatched detection
  const computedTransactions = transactions.map((tx) => {
    const isUnmatched = !heldSymbols.has(tx.symbol)
    return {
      ...tx,
      dateStr: new Date(tx.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      sharesStr: tx.shares ? tx.shares.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—',
      priceStr: tx.price ? fmtUSD(tx.price) : '—',
      amountStr: fmtUSD(tx.amount != null ? tx.amount : tx.shares * tx.price),
      taxesStr: tx.taxes != null ? fmtUSD(tx.taxes) : '—',
      tagClass: txTagClass[tx.type] || 'tag-neutral',
      unmatched: isUnmatched,
    }
  })

  return (
    <div style={{ marginBottom: 'var(--space-6)' }}>
      {/* Type filter tags + search */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-3)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {/* Transaction type filter tags */}
          {transactionTypes.map((type) => (
            <span
              key={type}
              onClick={() => handleTypeFilterClick(type)}
              className={`tag ${state.txTypeFilter === type ? 'tag-accent' : 'tag-outline'}`}
              style={{ cursor: 'pointer' }}
            >
              {type}
            </span>
          ))}
        </div>

        {/* Search input */}
        <div
          className="field"
          style={{
            margin: 0,
            width: '220px',
            position: 'relative',
          }}
        >
          <input
            className="input"
            placeholder="Search symbol"
            value={state.txSearch}
            onChange={handleTxSearchChange}
            style={{ paddingLeft: '30px' }}
          />
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="14"
            height="14"
            style={{
              position: 'absolute',
              left: '9px',
              top: '11px',
              opacity: 0.55,
            }}
          >
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.3-4.3"></path>
          </svg>
        </div>
      </div>

      {/* Transactions table */}
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Symbol</th>
            <th>Type</th>
            <th style={{ textAlign: 'right' }}>Shares</th>
            <th style={{ textAlign: 'right' }}>Cost Basis</th>
            <th style={{ textAlign: 'right' }}>Amount Invested</th>
            <th style={{ textAlign: 'right' }}>Taxes</th>
            <th style={{ textAlign: 'center' }}>Position Link</th>
          </tr>
        </thead>
        <tbody>
          {computedTransactions.map((tx) => (
            <tr key={tx.id}>
              <td className="text-muted">{tx.dateStr}</td>
              <td style={{ fontWeight: '600' }}>{tx.symbol}</td>
              <td>
                <span className={`tag ${tx.tagClass}`}>{tx.type}</span>
              </td>
              <td style={{ textAlign: 'right' }}>{tx.sharesStr}</td>
              <td style={{ textAlign: 'right' }}>{tx.priceStr}</td>
              <td style={{ textAlign: 'right', fontWeight: '600' }}>{tx.amountStr}</td>
              <td style={{ textAlign: 'right' }}>{tx.taxesStr}</td>
              <td style={{ textAlign: 'center' }}>
                {tx.unmatched && (
                  <span
                    className="tag tag-outline"
                    title="No matching open position — likely fully sold or removed"
                  >
                    UNMATCHED
                  </span>
                )}
                {!tx.unmatched && (
                  <span className="text-muted">Linked</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
