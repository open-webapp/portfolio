import { useCallback, useState } from 'react'
import type { Account } from '../lib/types'

export interface InstitutionSelectProps {
  value: string
  accounts: Account[]
  onChange: (value: string) => void
}

const SEEDED_INSTITUTIONS = [
  'Fidelity',
  'Charles Schwab',
  'Vanguard',
  'E*TRADE',
  'Robinhood',
  'Merrill Lynch',
  'Chase',
  'Bank of America',
  'Wells Fargo',
  'Other',
]

/**
 * InstitutionSelect component: dropdown for selecting account institution.
 * Provides seeded options ∪ institutions already in use across accounts, with free-typing support.
 */
export function InstitutionSelect({ value, accounts, onChange }: InstitutionSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  // Compute unique institutions already in use across accounts
  const inUseInstitutions = Array.from(
    new Set(accounts.map((a) => a.institution ?? '').filter((inst) => inst !== ''))
  )

  // Compute combined options: seeded list first (in order), then any in-use but not seeded (alphabetized)
  const seededSet = new Set(SEEDED_INSTITUTIONS)
  const notSeeded = inUseInstitutions.filter((inst) => !seededSet.has(inst)).sort()
  const allOptions = [...SEEDED_INSTITUTIONS, ...notSeeded]

  // Filter options based on search term (case-insensitive)
  const filteredOptions = allOptions.filter((opt) =>
    opt.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Check if search term is a new value (not in all options)
  const isNewValue =
    searchTerm.trim() !== '' &&
    !allOptions.some((opt) => opt.toLowerCase() === searchTerm.toLowerCase())

  const handleSelect = useCallback(
    (selectedValue: string) => {
      onChange(selectedValue)
      setIsOpen(false)
      setSearchTerm('')
    },
    [onChange]
  )

  const handleInputChange = (text: string) => {
    setSearchTerm(text)
    setIsOpen(true)
  }

  const handleFocus = () => {
    setIsOpen(true)
  }

  const handleBlur = () => {
    // Close menu when clicking outside; if text was typed but not selected, keep it as searchTerm
    // until user clicks away completely
    setTimeout(() => {
      setIsOpen(false)
    }, 100)
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <input
        type="text"
        className="input"
        placeholder="— Select —"
        value={searchTerm || value}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={{
          width: '100%',
        }}
      />
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            backgroundColor: 'white',
            border: '1px solid var(--color-divider)',
            borderTop: 'none',
            borderRadius: '0 0 4px 4px',
            maxHeight: '200px',
            overflowY: 'auto',
            zIndex: 1000,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
          }}
        >
          {filteredOptions.length > 0 && (
            <div>
              {filteredOptions.map((opt) => (
                <button
                  key={opt}
                  onClick={() => handleSelect(opt)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    border: 'none',
                    backgroundColor: value === opt ? 'var(--color-accent-light)' : 'transparent',
                    cursor: 'pointer',
                    fontSize: '14px',
                    transition: 'background-color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                      'var(--color-accent-light)'
                  }}
                  onMouseLeave={(e) => {
                    if (value !== opt) {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
                    }
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          {isNewValue && (
            <button
              onClick={() => handleSelect(searchTerm.trim())}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                border: 'none',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
                color: 'var(--color-accent)',
                transition: 'background-color 0.15s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  'var(--color-accent-light)'
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
              }}
            >
              Add "{searchTerm.trim()}"
            </button>
          )}
          {filteredOptions.length === 0 && !isNewValue && (
            <div
              style={{
                padding: '8px 12px',
                fontSize: '14px',
                color: 'var(--color-text-secondary)',
              }}
            >
              No matches
            </div>
          )}
        </div>
      )}
    </div>
  )
}
