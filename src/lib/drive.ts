import type { AppState } from './state'
import { coalesceWithDefaults } from './persist'
import { decryptState, encryptState } from './crypto'
import type { EncryptedEnvelope } from './crypto'
import type { SyncDocument } from '@open-webapp/project-sync'

/**
 * Thrown when decryption fails due to a wrong key (auth-tag mismatch).
 * Carries the salt and envelope for retry scenarios (e.g., prompt for different password).
 */
export class DriveDecryptError extends Error {
  salt: Uint8Array
  envelope: EncryptedEnvelope

  constructor(message: string, salt: Uint8Array, envelope: EncryptedEnvelope) {
    super(message)
    this.name = 'DriveDecryptError'
    this.salt = salt
    this.envelope = envelope
  }
}


/**
 * Creates a single encrypted SyncDocument for the portfolio state.
 * Handles serialization (AppState → JSON → encrypt → Uint8Array)
 * and deserialization (Uint8Array → decrypt → JSON → AppState).
 *
 * T33 Implementation:
 * - name: 'portfolio-state.json'
 * - readLocal: load + encryptState envelope → Uint8Array
 * - merge: decrypt both, remote-replace-or-local-wins per existing semantics
 * - writeLocal: decrypt + persist
 * - crypto.ts untouched
 *
 * Decision 20: writeLocal is never called on pure push, only on merge/restore.
 * Decision 22: rebuilt from each fresh read, never accumulated across attempts.
 */
export function createPortfolioSyncDocument(
  key: CryptoKey,
  salt: Uint8Array,
  readAppState: () => Promise<AppState | null>,
  writeAppState: (state: AppState) => Promise<void>
): SyncDocument {
  return {
    key: 'portfolio-state',
    name: 'portfolio-state.json',
    mimeType: 'application/json',

    /**
     * Serialize local app state to encrypted bytes.
     * Returns null if no local state exists (shouldn't happen in portfolio's case).
     */
    async readLocal(): Promise<Uint8Array | null> {
      const state = await readAppState()
      if (!state) return null

      const envelope = await encryptState(state, key, salt)
      return new TextEncoder().encode(JSON.stringify(envelope))
    },

    /**
     * Merge local and remote encrypted state.
     *
     * Decrypt both (if they exist), then apply remote-replace-or-local-wins semantics:
     * - Both exist: remote wins (user's latest Drive backup is authoritative on restore)
     * - Only remote: use remote (downloaded backup)
     * - Only local: use local (user hasn't sync'd to Drive yet)
     * - Neither: return empty state
     *
     * Decision 11: merge is required. This is the only place app semantics matter.
     */
    async merge(
      local: string | Uint8Array | null,
      remote: string | Uint8Array | null
    ): Promise<{ merged: string | Uint8Array; conflicts: unknown[] }> {
      let localState: AppState | null = null
      let remoteState: AppState | null = null

      // Decrypt local
      if (local) {
        try {
          const localStr = typeof local === 'string' ? local : new TextDecoder().decode(local)
          const envelope = JSON.parse(localStr) as EncryptedEnvelope
          localState = await decryptState(envelope, key)
        } catch (error) {
          // If local can't decrypt, treat as absent
          console.warn('Failed to decrypt local state during merge:', error)
          localState = null
        }
      }

      // Decrypt remote
      if (remote) {
        try {
          const remoteStr = typeof remote === 'string' ? remote : new TextDecoder().decode(remote)
          const envelope = JSON.parse(remoteStr) as EncryptedEnvelope
          remoteState = await decryptState(envelope, key)
        } catch (error) {
          if (error instanceof Error && error.name === 'OperationError') {
            throw new DriveDecryptError(
              'Remote backup encrypted with a different password',
              salt,
              JSON.parse(typeof remote === 'string' ? remote : new TextDecoder().decode(remote))
            )
          }
          throw error
        }
      }

      // Apply remote-replace-or-local-wins
      const merged = remoteState ?? localState
      if (!merged) {
        // Neither exists; return empty state as JSON string
        const emptyEnvelope = await encryptState({} as AppState, key, salt)
        return {
          merged: JSON.stringify(emptyEnvelope),
          conflicts: [],
        }
      }

      // Serialize merged state back to encrypted envelope bytes
      const envelope = await encryptState(merged, key, salt)
      const merged_bytes = new TextEncoder().encode(JSON.stringify(envelope))
      return {
        merged: merged_bytes,
        conflicts: [],
      }
    },

    /**
     * Persist merged/restored state locally.
     * Only called on merge or explicit restore, not on pure push.
     */
    async writeLocal(merged: string | Uint8Array): Promise<void> {
      // Decrypt the merged envelope
      const mergedStr = typeof merged === 'string' ? merged : new TextDecoder().decode(merged)
      const envelope = JSON.parse(mergedStr) as EncryptedEnvelope
      const state = await decryptState(envelope, key)

      // Coalesce with defaults for migration tolerance
      const coalesced = coalesceWithDefaults(state)

      // Write to app state persistence
      await writeAppState(coalesced)
    },
  }
}
