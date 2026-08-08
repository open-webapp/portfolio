import { useCallback, useState } from 'react'
import type { MappingProfile } from '../../lib/types'
import {
  POSITIONS_REQUIRED_FIELDS,
  POSITIONS_OPTIONAL_FIELDS,
  TRANSACTIONS_REQUIRED_FIELDS,
  TRANSACTIONS_OPTIONAL_FIELDS,
} from '../../lib/types'
import { createProfile, updateProfile, validateProfile } from '../../lib/mappingProfiles'

export interface MappingProfileEditorProps {
  kind: 'positions' | 'transactions'
  csvHeaders: string[]
  existingProfile?: MappingProfile
  constants?: Record<string, string>
  onConstantsChange?: (field: string, value: string) => void
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
  constants: propsConstants,
  onConstantsChange,
  onSave,
  onCancel,
}: MappingProfileEditorProps) {
  const requiredFields =
    kind === 'positions' ? POSITIONS_REQUIRED_FIELDS : TRANSACTIONS_REQUIRED_FIELDS
  const optionalFields =
    kind === 'positions' ? POSITIONS_OPTIONAL_FIELDS : TRANSACTIONS_OPTIONAL_FIELDS

  const [profileName, setProfileName] = useState(
    existingProfile?.name || `${kind} Profile`
  )
  const [fieldMap, setFieldMap] = useState<Record<string, string>>(
    existingProfile?.fieldMap || {}
  )
  const [localConstants, setLocalConstants] = useState<Record<string, string>>(
    existingProfile?.constants || propsConstants || {}
  )
  const [errors, setErrors] = useState<string[]>([])

  const handleFieldMapChange = useCallback(
    (requiredField: string, csvColumn: string) => {
      if (csvColumn === '') {
        // Clear mapping for this field
        setFieldMap((prev) => {
          const next = { ...prev }
          delete next[csvColumn]
          return next
        })
        // Also clear any constant for this field
        setLocalConstants((prev) => {
          const next = { ...prev }
          delete next[requiredField]
          return next
        })
      } else if (csvColumn === '__CONSTANT__') {
        // User selected "Enter a value..." - remove from fieldMap, add placeholder to constants
        setFieldMap((prev) => {
          const next = { ...prev }
          // Remove any CSV column mapping for this field
          for (const [col, field] of Object.entries(prev)) {
            if (field === requiredField) {
              delete next[col]
            }
          }
          return next
        })
        // Add placeholder to constants so input appears
        setLocalConstants((prev) => ({
          ...prev,
          [requiredField]: prev[requiredField] || '',
        }))
      } else {
        // Normal CSV column mapping
        setFieldMap((prev) => ({
          ...prev,
          [csvColumn]: requiredField,
        }))
        // Clear any constant for this field when mapping to a CSV column
        setLocalConstants((prev) => {
          const next = { ...prev }
          delete next[requiredField]
          return next
        })
      }
    },
    []
  )

  const handleConstantChange = useCallback(
    (field: string, value: string) => {
      setLocalConstants((prev) => ({
        ...prev,
        [field]: value,
      }))
      onConstantsChange?.(field, value)
    },
    [onConstantsChange]
  )

  const handleSave = useCallback(() => {
    // Build a new profile object to validate
    const newProfile = existingProfile
      ? updateProfile(existingProfile, profileName, fieldMap, localConstants)
      : createProfile(profileName, kind, fieldMap, localConstants)

    // Validate the profile
    const validation = validateProfile(newProfile, kind)
    if (!validation.valid) {
      setErrors(validation.errors)
      return
    }

    setErrors([])
    onSave(newProfile)
  }, [existingProfile, profileName, fieldMap, localConstants, kind, onSave])

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
          <div key={requiredField}>
            <div
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
                value={
                  localConstants[requiredField] !== undefined
                    ? '__CONSTANT__'
                    : reverseMap[requiredField] || ''
                }
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
                <option value="__CONSTANT__">Enter a value...</option>
              </select>
            </div>
            {localConstants[requiredField] !== undefined && (
              <div
                style={{
                  marginTop: '6px',
                  marginLeft: '128px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <label style={{ fontSize: '0.9em', color: 'var(--color-text-secondary)' }}>
                  Value:
                </label>
                <input
                  type="text"
                  className="input"
                  value={localConstants[requiredField] || ''}
                  onChange={(e) => handleConstantChange(requiredField, e.target.value)}
                  style={{ flex: 1, maxWidth: '200px' }}
                  placeholder="Enter constant value"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Optional fields mapping */}
      {optionalFields.length > 0 && (
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <strong>Map Optional Fields:</strong>
          {(optionalFields as readonly string[]).map((optionalField) => (
            <div key={optionalField}>
              <div
                style={{
                  marginTop: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <label style={{ minWidth: '120px', fontWeight: '500' }}>
                  {optionalField}:
                </label>
                <select
                  className="input"
                  value={
                    localConstants[optionalField] !== undefined
                      ? '__CONSTANT__'
                      : reverseMap[optionalField] || ''
                  }
                  onChange={(e) =>
                    handleFieldMapChange(optionalField, e.target.value)
                  }
                  style={{ flex: 1, maxWidth: '200px' }}
                >
                  <option value="">-- Select CSV column --</option>
                  {csvHeaders.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                  <option value="__CONSTANT__">Enter a value...</option>
                </select>
              </div>
              {localConstants[optionalField] !== undefined && (
                <div
                  style={{
                    marginTop: '6px',
                    marginLeft: '128px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <label style={{ fontSize: '0.9em', color: 'var(--color-text-secondary)' }}>
                    Value:
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={localConstants[optionalField] || ''}
                    onChange={(e) => handleConstantChange(optionalField, e.target.value)}
                    style={{ flex: 1, maxWidth: '200px' }}
                    placeholder="Enter constant value"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
          Save as profile
        </button>
      </div>
    </div>
  )
}
