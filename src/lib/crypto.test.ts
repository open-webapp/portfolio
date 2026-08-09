import { describe, it, expect } from 'vitest'
import {
  detectEnvelopeShape,
  generateSalt,
  deriveKey,
  encryptState,
  decryptState,
} from './crypto'
import { initialState } from './state'
import type { AppState } from './state'

function fixtureState(): AppState {
  return {
    ...initialState(),
    accounts: [
      {
        id: 'acc1',
        number: '12345',
        name: 'Test Account',
        institution: 'Bank',
        accountType: 'brokerage',
        isRetirement: false,
      },
    ],
    positions: [
      {
        id: 'pos1',
        accountId: 'acc1',
        symbol: 'AAPL',
        quantity: 100,
        costBasis: 15000,
        marketValue: 20000,
        gainLoss: 5000,
        assetClass: 'Equities',
        taxableAccount: true,
      },
    ],
  }
}

describe('crypto', () => {
  describe('detectEnvelopeShape', () => {
    it('classifies undefined as absent', () => {
      expect(detectEnvelopeShape(undefined)).toBe('absent')
    })

    it('classifies null as absent', () => {
      expect(detectEnvelopeShape(null)).toBe('absent')
    })

    it('classifies a legacy AppState-shaped object as legacy-plaintext', () => {
      const legacy: Partial<AppState> = { accounts: [], positions: [] }
      expect(detectEnvelopeShape(legacy)).toBe('legacy-plaintext')
    })

    it('classifies a full legacy AppState blob as legacy-plaintext', () => {
      expect(detectEnvelopeShape(initialState())).toBe('legacy-plaintext')
    })

    it('classifies a well-formed envelope as encrypted', () => {
      const envelope = { version: 1, salt: 'x', iv: 'y', ciphertext: 'z' }
      expect(detectEnvelopeShape(envelope)).toBe('encrypted')
    })
  })

  describe('encryptState / decryptState round-trip', () => {
    it('decrypts back to the original AppState with a key derived from the same password+salt', async () => {
      const salt = generateSalt()
      const key = await deriveKey('correct horse battery staple', salt)
      const state = fixtureState()

      const envelope = await encryptState(state, key, salt)
      const decryptKey = await deriveKey('correct horse battery staple', salt)
      const decrypted = await decryptState(envelope, decryptKey)

      expect(decrypted).toEqual(state)
    })
  })

  describe('key derivation is bound to salt and password', () => {
    it('rejects decryption when the salt used to derive the key differs', async () => {
      const saltA = generateSalt()
      const saltB = generateSalt()
      const keyA = await deriveKey('same-password', saltA)
      const keyB = await deriveKey('same-password', saltB)

      const envelope = await encryptState(fixtureState(), keyA, saltA)

      await expect(decryptState(envelope, keyB)).rejects.toThrow()
    })

    it('rejects decryption when the password used to derive the key differs', async () => {
      const salt = generateSalt()
      const keyA = await deriveKey('password-a', salt)
      const keyB = await deriveKey('password-b', salt)

      const envelope = await encryptState(fixtureState(), keyA, salt)

      await expect(decryptState(envelope, keyB)).rejects.toThrow()
    })
  })

  describe('IV uniqueness', () => {
    it('produces a different iv and ciphertext on each call, even with identical inputs', async () => {
      const salt = generateSalt()
      const key = await deriveKey('some-password', salt)
      const state = fixtureState()

      const envelope1 = await encryptState(state, key, salt)
      const envelope2 = await encryptState(state, key, salt)

      expect(envelope1.iv).not.toBe(envelope2.iv)
      expect(envelope1.ciphertext).not.toBe(envelope2.ciphertext)
    })
  })

  describe('no plaintext password leakage', () => {
    it('does not include the password anywhere in the serialized envelope', async () => {
      const password = 'super-secret-passphrase-12345'
      const salt = generateSalt()
      const key = await deriveKey(password, salt)
      const state = fixtureState()

      const envelope = await encryptState(state, key, salt)
      const serialized = JSON.stringify(envelope)

      expect(serialized).not.toContain(password)
    })
  })
})
