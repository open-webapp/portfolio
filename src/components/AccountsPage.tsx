import React, { useState } from 'react'
import type { AppState } from '../lib/state'
import type { Position } from '../lib/types'
import { accountsSections, assetClassOptions } from '../lib/selectors'
import { PositionGroupOverlay } from './PositionGroupOverlay'

export interface AccountsPageProps {
  state: AppState
  dispatch: (action: any) => void
}

/**
 * Renders a read-only summary of accounts grouped by tax category.
 * Displays cash/investment/total values for each account, with subtotals per category.
 * Three sections: Taxable, Non-Taxable, Tax-Deferred (in that order).
 */
export function AccountsPage({ state, dispatch }: AccountsPageProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const sections = accountsSections(state)

  return (
    <div style={{ padding: 'var(--space-6)' }}>
      {sections.map((sec) => (
        <React.Fragment key={sec.label}>
          <div
            className="card blueprint elev-sm"
            style={{
              marginBottom: 'var(--space-5)'
            }}
          >
            <div
              className="card-title"
              style={{
                marginBottom: 'var(--space-4)',
                fontSize: '14px'
              }}
            >
              {sec.label}
            </div>

            {sec.hasRows ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Financial Institution</th>
                    <th>Account</th>
                    <th style={{ textAlign: 'right' }}>Cash</th>
                    <th style={{ textAlign: 'right' }}>Investment</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sec.rows.map((r, idx) => (
                    <tr key={idx} onClick={() => setSelectedAccountId(r.accountId)} style={{ cursor: 'pointer' }}>
                      <td>{r.institution}</td>
                      <td>{r.accountName}</td>
                      <td style={{ textAlign: 'right' }}>{r.cashStr}</td>
                      <td style={{ textAlign: 'right' }}>{r.investmentStr}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.totalStr}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '1px solid var(--color-divider)' }}>
                    <td colSpan={2}>
                      <div
                        style={{
                          fontFamily: 'var(--font-heading)',
                          fontWeight: 600,
                          fontSize: '12px',
                          textTransform: 'uppercase'
                        }}
                      >
                        Subtotal
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{sec.cashTotalStr}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{sec.investmentTotalStr}</td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 600,
                        color: 'var(--color-accent-700)'
                      }}
                    >
                      {sec.grandTotalStr}
                    </td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              <div className="text-muted" style={{ fontSize: '12px' }}>
                No accounts in this category.
              </div>
            )}
          </div>

          {sec.showDivider && (
            <div
              style={{
                height: 'var(--space-6)',
                borderBottom: '1px solid var(--color-divider)',
                marginBottom: 'var(--space-5)'
              }}
            />
          )}
        </React.Fragment>
      ))}
      {selectedAccountId && (() => {
        const account = state.accounts.find(a => a.id === selectedAccountId)
        if (!account) return null
        const positions = state.positions.filter(p => p.accountId === selectedAccountId)
        const accountLabel = `${account.name} (${account.accountNumber})`
        const title = account.institution ? `${account.institution} — ${accountLabel}` : accountLabel
        return (
          <PositionGroupOverlay
            positions={positions}
            title={title}
            accounts={state.accounts}
            dispatch={dispatch}
            onClose={() => setSelectedAccountId(null)}
            existingAssetClasses={assetClassOptions(state)}
            state={state}
            sortPositions={(a: Position, b: Position) => a.symbol.localeCompare(b.symbol)}
          />
        )
      })()}
    </div>
  )
}
