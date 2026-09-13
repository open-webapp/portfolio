import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, configure } from '@testing-library/react'
import { GateRestoreFromFilePanel } from './GateRestoreFromFilePanel'
import { initialState, replaceImportedState } from '../lib/state'
import { exportBackup, buildExportableState } from '../lib/importExport'
import { generateSalt } from '../lib/crypto'

// This suite drives the REAL PBKDF2 deriveKey (600,000 SHA-256 iterations,
// see crypto.ts) rather than mocking it, since a fake key wouldn't round-trip
// through real SubtleCrypto decrypt (decryptImportEnvelope derives its own
// key internally). That's genuinely CPU-heavy, and under full-suite
// concurrency (many test files' worker processes contending for the same CPU
// cores) it can take longer than testing-library's default 1000ms waitFor
// timeout even though it completes in well under 1s in isolation. Bump the
// timeout so real-crypto-driven assertions aren't flaky under contention.
configure({ asyncUtilTimeout: 5000 })

// parseImportFile (in ../lib/importExport) calls detectEnvelopeShape
// internally, so the crypto mock must keep the real implementation for
// everything (including detectEnvelopeShape). deriveKey is wrapped in a spy
// so calls can be asserted, but it delegates to the real implementation —
// decryptImportEnvelope derives its own key internally to actually decrypt
// the envelope, so a key that doesn't work with SubtleCrypto would break
// decryption for both the correct- and wrong-password cases.
const mockDeriveKey = vi.fn(
  async (...args: Parameters<typeof import('../lib/crypto').deriveKey>) => {
    const actual = await vi.importActual<typeof import('../lib/crypto')>('../lib/crypto')
    return actual.deriveKey(...args)
  }
)

vi.mock('../lib/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/crypto')>()
  return {
    ...actual,
    deriveKey: (...args: Parameters<typeof actual.deriveKey>) => mockDeriveKey(...args),
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function getFileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement
}

async function buildBackupFile(password: string, state = initialState()) {
  const salt = generateSalt()
  const key = await mockDeriveKey(password, salt)
  const envelope = await exportBackup(state, key, salt)
  return {
    file: new File([JSON.stringify(envelope)], 'backup.json', { type: 'application/json' }),
    state,
  }
}

describe('GateRestoreFromFilePanel', () => {
  it('happy path: upload a valid backup, enter the correct password, unlocks with key/salt/merged state and never confirms', async () => {
    const backupState = initialState()
    backupState.accounts = [
      {
        id: 'acc-1',
        accountNumber: '123',
        name: 'Restored Account',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]
    const { file } = await buildBackupFile('correct-password', backupState)
    const confirmSpy = vi.spyOn(window, 'confirm')
    const onUnlock = vi.fn()

    const { container } = render(<GateRestoreFromFilePanel onUnlock={onUnlock} />)

    fireEvent.change(getFileInput(container), { target: { files: [file] } })

    const passwordInput = await screen.findByPlaceholderText('Backup password')
    fireEvent.change(passwordInput, { target: { value: 'correct-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(onUnlock).toHaveBeenCalledTimes(1)
    })

    const [key, salt, mergedState] = onUnlock.mock.calls[0]
    expect(key).toBeTruthy()
    expect(mockDeriveKey).toHaveBeenCalledWith('correct-password', expect.any(Uint8Array))
    expect(salt).toBeInstanceOf(Uint8Array)

    const expectedExportable = buildExportableState(backupState)
    const expectedMerged = replaceImportedState(initialState(), expectedExportable)
    expect(mergedState).toEqual(expectedMerged)

    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('wrong password: shows "Incorrect password", clears the password field, keeps the prompt open without re-picking the file', async () => {
    const { file } = await buildBackupFile('correct-password')
    const onUnlock = vi.fn()

    const { container } = render(<GateRestoreFromFilePanel onUnlock={onUnlock} />)

    fireEvent.change(getFileInput(container), { target: { files: [file] } })

    const passwordInput = await screen.findByPlaceholderText('Backup password')
    fireEvent.change(passwordInput, { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(screen.getByText('Incorrect password')).toBeTruthy()
    })

    expect(onUnlock).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('Backup password')).toBeTruthy()
    expect((screen.getByPlaceholderText('Backup password') as HTMLInputElement).value).toBe('')
  })

  it('malformed file: shows "This file isn\'t a valid backup", no password prompt, no unlock', async () => {
    const file = new File(['not json{{'], 'backup.json', { type: 'application/json' })
    const onUnlock = vi.fn()

    const { container } = render(<GateRestoreFromFilePanel onUnlock={onUnlock} />)

    fireEvent.change(getFileInput(container), { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText("This file isn't a valid backup")).toBeTruthy()
    })

    expect(screen.queryByPlaceholderText('Backup password')).toBeFalsy()
    expect(onUnlock).not.toHaveBeenCalled()
  })
})
