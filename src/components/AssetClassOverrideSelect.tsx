import { useCallback, useState } from 'react'
import type { Position, AssetClass } from '../lib/types'

export interface AssetClassOverrideSelectProps {
  position: Position
  dispatch: (action: any) => void
}

/**
 * AssetClassOverrideSelect component: dropdown for manually overriding a position's asset class.
 * Provides seeded options and free-typing support.
 */
export function AssetClassOverrideSelect({ position, dispatch }: AssetClassOverrideSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const seededOptions: AssetClass[] = [
    'Equity',
    'ETF',
    'Mutual Fund',
    'Fixed Income',
    'Crypto',
    'Cash',
    'Other',
  ]

  const currentValue = position.assetClassManualOverride || position.assetClass

  // Filter options based on search term
  const filteredOptions = seededOptions.filter((opt) =>
    opt.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Check if search term is a new value (not in seeded options)
  const isNewValue =
    searchTerm.trim() !== '' &&
    !seededOptions.some((opt) => opt.toLowerCase() === searchTerm.toLowerCase())

  const handleSelect = useCallback(
    (value: string) => {
      dispatch({
        type: 'SET_ASSET_CLASS_OVERRIDE',
        positionId: position.id,
        override: value || undefined,
      })
      setIsOpen(false)
      setSearchTerm('')
    },
    [dispatch, position.id]
  )

  const handleClearOverride = useCallback(() => {
    dispatch({
      type: 'SET_ASSET_CLASS_OVERRIDE',
      positionId: position.id,
      override: undefined,
    })
    setIsOpen(false)
    setSearchTerm('')
  }, [dispatch, position.id])

  return (
    <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '4px 8px',
          fontSize: '12px',
          backgroundColor: position.assetClassManualOverride ? 'var(--color-accent)' : 'transparent',
          color: position.assetClassManualOverride ? 'white' : 'currentColor',
          border: '1px solid var(--color-divider)',
          borderRadius: '4px',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'center',
          minHeight: '28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title={position.assetClassManualOverride ? `Override: ${position.assetClassManualOverride}` : 'Click to override'}
      >
        {position.assetClassManualOverride ? 'Override' : 'Set'}
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '4px',
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-divider)',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            zIndex: 1000,
            minWidth: '150px',
          }}
        >
          {/* Search/input field */}
          <input
            autoFocus
            type="text"
            placeholder="Type or select..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              fontSize: '12px',
              border: 'none',
              borderBottom: '1px solid var(--color-divider)',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />

          {/* Clear override option (if override is set) */}
          {position.assetClassManualOverride && (
            <>
              <div
                onClick={handleClearOverride}
                style={{
                  padding: '8px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  backgroundColor: 'transparent',
                  borderBottom: '1px solid var(--color-divider)',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-accent-25)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                }}
              >
                Clear override
              </div>
            </>
          )}

          {/* Option list */}
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {filteredOptions.length === 0 && !isNewValue && (
              <div style={{ padding: '8px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                No options found
              </div>
            )}

            {filteredOptions.map((option) => (
              <div
                key={option}
                onClick={() => handleSelect(option)}
                style={{
                  padding: '8px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  backgroundColor: currentValue === option ? 'var(--color-accent-25)' : 'transparent',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (currentValue !== option) {
                    e.currentTarget.style.backgroundColor = 'var(--color-accent-10)'
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor =
                    currentValue === option ? 'var(--color-accent-25)' : 'transparent'
                }}
              >
                {option}
              </div>
            ))}

            {/* New value option */}
            {isNewValue && (
              <div
                onClick={() => handleSelect(searchTerm)}
                style={{
                  padding: '8px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  backgroundColor: 'transparent',
                  borderTop: '1px solid var(--color-divider)',
                  fontStyle: 'italic',
                  color: 'var(--color-accent-700)',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-accent-10)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                }}
              >
                + Use "{searchTerm}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
