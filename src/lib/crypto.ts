// Encrypted-at-rest envelope for persisted AppState. See plans/data-encryption-at-rest.md.

import type { AppState } from './state'

export interface EncryptedEnvelope {
  version: 1
  salt: string // base64
  iv: string // base64
  ciphertext: string // base64
}

/**
 * Classifies a value loaded from persistence (or about to be persisted) as:
 * - 'absent': nothing stored yet (undefined/null)
 * - 'encrypted': already an EncryptedEnvelope
 * - 'legacy-plaintext': a pre-encryption plaintext AppState blob
 *
 * Pure — no I/O, no crypto calls.
 */
export function detectEnvelopeShape(value: unknown): 'absent' | 'legacy-plaintext' | 'encrypted' {
  if (value === undefined || value === null) return 'absent'
  if (typeof value !== 'object') return 'legacy-plaintext'

  const obj = value as Record<string, unknown>
  if (
    obj.version === 1 &&
    typeof obj.salt === 'string' &&
    typeof obj.iv === 'string' &&
    typeof obj.ciphertext === 'string'
  ) {
    return 'encrypted'
  }

  return 'legacy-plaintext'
}

export const PBKDF2_ITERATIONS = 600_000

function utf8(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

/**
 * Generates a random 16-byte salt for PBKDF2 key derivation.
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

/**
 * Derives a non-extractable AES-GCM 256-bit key from a password and salt via PBKDF2.
 * The key never leaves SubtleCrypto (extractable: false).
 */
export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    utf8(password) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Generates a fresh random 96-bit (12-byte) IV for AES-GCM.
 * Must be called fresh for every encryption — never reuse an IV with the same key.
 */
export function generateIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12))
}

/**
 * Encrypts an AppState blob with AES-GCM under a fresh IV, returning a base64-encoded envelope.
 */
export async function encryptState(state: AppState, key: CryptoKey, salt: Uint8Array): Promise<EncryptedEnvelope> {
  const data = utf8(JSON.stringify(state))
  const iv = generateIv()
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource)

  return {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

/**
 * Decrypts an EncryptedEnvelope back into an AppState.
 * Lets crypto.subtle.decrypt's OperationError (auth-tag mismatch, e.g. wrong password)
 * propagate uncaught — callers must not swallow it.
 */
export async function decryptState(envelope: EncryptedEnvelope, key: CryptoKey): Promise<AppState> {
  const iv = base64ToBytes(envelope.iv)
  const ciphertextBytes = base64ToBytes(envelope.ciphertext)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertextBytes as BufferSource)
  const json = new TextDecoder().decode(plaintext)
  return JSON.parse(json) as AppState
}
