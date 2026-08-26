import { useRef, useState } from 'react'
import type { AppState } from '../lib/state'
import { initialState, replaceImportedState } from '../lib/state'
import {
  parseImportFile,
  decryptImportEnvelope,
  getEnvelopeSaltBytes,
  ImportDecryptError,
  ImportMalformedFileError,
} from '../lib/importExport'
import { deriveKey } from '../lib/crypto'
import type { EncryptedEnvelope } from '../lib/crypto'

export interface GateRestoreFromFilePanelProps {
  onUnlock: (key: CryptoKey, salt: Uint8Array, state: AppState) => void
}

/**
 * Pre-unlock restore-from-file flow: pick a backup file, enter its
 * encryption password, and unlock straight into the restored state. There is
 * nothing to overwrite yet at this point in the app lifecycle, so unlike the
 * post-unlock import flow in Settings, this never prompts with
 * window.confirm.
 */
export function GateRestoreFromFilePanel({ onUnlock }: GateRestoreFromFilePanelProps) {
  const [envelope, setEnvelope] = useState<EncryptedEnvelope | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const text = await file.text()
    try {
      const parsed = parseImportFile(text)
      setEnvelope(parsed)
      setError(null)
      setPassword('')
    } catch (err) {
      if (err instanceof ImportMalformedFileError) {
        console.error('Restore file is malformed:', err)
      } else {
        console.error('Failed to parse restore file:', err)
      }
      setEnvelope(null)
      setError("This file isn't a valid backup")
    }
  }

  async function handlePasswordSubmit() {
    if (!envelope) return
    setError(null)
    setSubmitting(true)
    try {
      const decrypted = await decryptImportEnvelope(envelope, password)
      const saltBytes = getEnvelopeSaltBytes(envelope)
      const key = await deriveKey(password, saltBytes)
      const mergedState = replaceImportedState(initialState(), decrypted)
      onUnlock(key, saltBytes, mergedState)
    } catch (err) {
      if (err instanceof ImportDecryptError) {
        setError('Incorrect password')
        setPassword('')
      } else {
        console.error('Unexpected error decrypting restore file:', err)
        setError('Failed to restore backup')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <input
        type="file"
        accept=".json,application/json"
        ref={fileInputRef}
        onChange={handleFileChange}
      />

      {envelope && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Backup password"
            disabled={submitting}
          />
          {error && (
            <div style={{ color: 'var(--color-error)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            <button
              className="btn btn-primary blueprint"
              onClick={handlePasswordSubmit}
              disabled={submitting}
            >
              Submit
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setEnvelope(null)
                setPassword('')
                setError(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              disabled={submitting}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!envelope && error && (
        <div style={{ color: 'var(--color-error)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
          {error}
        </div>
      )}
    </div>
  )
}
