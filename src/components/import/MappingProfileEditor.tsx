import { useCallback, useState } from 'react'
import type { MappingProfile } from '../../lib/types'
import { POSITIONS_REQUIRED_FIELDS, TRANSACTIONS_REQUIRED_FIELDS } from '../../lib/types'
import { createProfile, updateProfile, validateProfile } from '../../lib/mappingProfiles'

export interface MappingProfileEditorProps {
  kind: 'positions' | 'transactions'
  csvHeaders: string[]
  existingProfile?: MappingProfile
  onSave: (profile: MappingProfile) => void
  onCancel: () => void
}

/**
 * MappingProfileEditor: Allows user to map CSV columns to required fields.
 * Reusable for both positions and transactions.
 */
export function MappingProfileEditor({
  kind,
  csvHeaders,
  existingProfile,
  onSave,
  onCancel,
}: MappingProfileEditorProps) {
  const requiredFields =
    kind === 'positions' ? POSITIONS_REQUIRED_FIELDS : TRANSACTIONS_REQUIRED_FIELDS

  const [profileName, setProfileName] = useState(
    existingProfile?.name || `${kind} Profile`
  )
  const [fieldMap, setFieldMap] = useState<Record<string, string>>(
    existingProfile?.fieldMap || {}
  )
  const [accountNumberColumn, setAccountNumberColumn] = useState(
    existingProfile?.accountNumberColumn || ''
  )
  const [errors, setErrors] = useState<string[]>([])

  const handleFieldMapChange = useCallback(
    (requiredField: string, csvColumn: string) => {
      setFieldMap((prev) => ({
        ...prev,
        [csvColumn]: requiredField,
      }))
    },
    []
  )

  const handleAccountNumberColumnChange = useCallback(
    (csvColumn: string) => {
      setAccountNumberColumn(csvColumn)
    },
    []
  )

  const handleSave = useCallback(() => {
    // Build a new profile object to validate
    const newProfile = existingProfile
      ? updateProfile(existingProfile, profileName, fieldMap, accountNumberColumn)
      : createProfile(profileName, kind, fieldMap, accountNumberColumn)

    // Validate the profile
    const validation = validateProfile(newProfile, kind)
    if (!validation.valid) {
      setErrors(validation.errors)
      return
    }

    setErrors([])
    onSave(newProfile)
  }, [existingProfile, profileName, fieldMap, accountNumberColumn, kind, onSave])

  // Reverse fieldMap to show which CSV column is mapped to each required field
  const reverseMap: Record<string, string> = {}
  for (const [csvCol, targetField] of Object.entries(fieldMap)) {
    reverseMap[targetField] = csvCol
  }

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        border: '1px solid var(--color-divider)',
        borderRadius: '4px',
        background: 'var(--color-surface)',
      }}
    >
      <h3>Mapping Profile Editor</h3>

      {/* Profile name input */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <label>
          Profile Name
          <input
            type="text"
            className="input"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            style={{ marginLeft: 'var(--space-2)', width: '200px' }}
          />
        </label>
      </div>

      {/* Required fields mapping */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <strong>Map Required Fields:</strong>
        {(requiredFields as readonly string[]).map((requiredField) => (
          <div
            key={requiredField}
            style={{
              marginTop: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <label style={{ minWidth: '120px', fontWeight: '500' }}>
              {requiredField}:
            </label>
            <select
              className="input"
              value={reverseMap[requiredField] || ''}
              onChange={(e) =>
                handleFieldMapChange(requiredField, e.target.value)
              }
              style={{ flex: 1, maxWidth: '200px' }}
            >
              <option value="">-- Select CSV column --</option>
              {csvHeaders.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Optional account number column */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <label>
          Account Number Column (optional):
          <select
            className="input"
            value={accountNumberColumn}
            onChange={(e) => handleAccountNumberColumnChange(e.target.value)}
            style={{ marginLeft: 'var(--space-2)', width: '200px' }}
          >
            <option value="">-- None --</option>
            {csvHeaders.map((header) => (
              <option key={header} value={header}>
                {header}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div
          style={{
            marginBottom: 'var(--space-3)',
            padding: '8px',
            background: 'var(--color-accent-2-100)',
            borderRadius: '3px',
            color: 'var(--color-accent-2-800)',
          }}
        >
          <strong>Validation Errors:</strong>
          <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
            {errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
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
          onClick={handleSave}
          style={{
            padding: '8px 16px',
            borderRadius: '4px',
            border: 'none',
            background: 'var(--color-accent)',
            color: 'var(--color-bg)',
            cursor: 'pointer',
          }}
        >
          Save Profile
        </button>
      </div>
    </div>
  )
}
