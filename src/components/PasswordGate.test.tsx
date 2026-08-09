import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { PasswordGate } from './PasswordGate'
import { initialState } from '../lib/state'
import * as cryptoModule from '../lib/crypto'
import * as persistModule from '../lib/persist'

vi.mock('../lib/crypto', () => ({
  deriveKey: vi.fn(),
  generateSalt: vi.fn(),
}))

vi.mock('../lib/persist', () => ({
  peekStoredSalt: vi.fn(),
  loadPersistedApp: vi.fn(),
  loadLegacyPlaintextApp: vi.fn(),
  clearPersistedApp: vi.fn(),
}))

const fakeKey = { fake: 'key' } as unknown as CryptoKey
const fakeSalt = new Uint8Array([1, 2, 3])

// Labels in PasswordGate are plain siblings of their inputs (no htmlFor/id
// association), so getByLabelText can't be used — query by input type instead.
function getPasswordInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll('input[type="password"]'))
}

function fillAndSubmitSetPassword(password: string, confirm: string) {
  const [passwordInput, confirmInput] = getPasswordInputs()
  fireEvent.change(passwordInput, { target: { value: password } })
  fireEvent.change(confirmInput, { target: { value: confirm } })
  fireEvent.click(screen.getByRole('button', { name: /set password/i }))
}

describe('PasswordGate', () => {
  const onUnlock = vi.fn()
  const onReset = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cryptoModule.generateSalt).mockReturnValue(fakeSalt)
    vi.mocked(cryptoModule.deriveKey).mockResolvedValue(fakeKey)
  })

  afterEach(() => {
    cleanup()
  })

  describe('shape: absent — set-password screen', () => {
    it('renders two password fields and the explanatory note', () => {
      render(<PasswordGate shape="absent" onUnlock={onUnlock} onReset={onReset} />)

      expect(screen.getByText('New password')).toBeTruthy()
      expect(screen.getByText('Confirm password')).toBeTruthy()
      expect(getPasswordInputs()).toHaveLength(2)
      expect(
        screen.getByText(/never saved anywhere, and you\s+will need to enter it every time/)
      ).toBeTruthy()
    })

    it('shows an inline error and does not call onUnlock when password is under 6 characters', async () => {
      render(<PasswordGate shape="absent" onUnlock={onUnlock} onReset={onReset} />)

      fillAndSubmitSetPassword('abc', 'abc')

      expect(await screen.findByText('Password must be at least 6 characters')).toBeTruthy()
      expect(onUnlock).not.toHaveBeenCalled()
    })

    it('shows an inline error and does not call onUnlock when confirm password does not match', async () => {
      render(<PasswordGate shape="absent" onUnlock={onUnlock} onReset={onReset} />)

      fillAndSubmitSetPassword('longenough', 'different')

      expect(await screen.findByText('Passwords do not match')).toBeTruthy()
      expect(onUnlock).not.toHaveBeenCalled()
    })

    it('calls onUnlock(key, salt, undefined) on valid submit', async () => {
      render(<PasswordGate shape="absent" onUnlock={onUnlock} onReset={onReset} />)

      fillAndSubmitSetPassword('longenough', 'longenough')

      await waitFor(() => {
        expect(onUnlock).toHaveBeenCalledWith(fakeKey, fakeSalt, undefined)
      })
      expect(persistModule.loadLegacyPlaintextApp).not.toHaveBeenCalled()
    })
  })

  describe('shape: legacy-plaintext — set-password screen', () => {
    it('loads legacy state and passes it as migratedState to onUnlock', async () => {
      const migrated = initialState()
      vi.mocked(persistModule.loadLegacyPlaintextApp).mockResolvedValue(migrated)

      render(<PasswordGate shape="legacy-plaintext" onUnlock={onUnlock} onReset={onReset} />)

      fillAndSubmitSetPassword('longenough', 'longenough')

      await waitFor(() => {
        expect(persistModule.loadLegacyPlaintextApp).toHaveBeenCalled()
        expect(onUnlock).toHaveBeenCalledWith(fakeKey, fakeSalt, migrated)
      })
    })
  })

  describe('shape: encrypted — enter-password screen', () => {
    it('renders a single password field, not two', () => {
      render(<PasswordGate shape="encrypted" onUnlock={onUnlock} onReset={onReset} />)

      expect(getPasswordInputs()).toHaveLength(1)
      expect(screen.getByText('Password')).toBeTruthy()
      expect(screen.queryByText('New password')).toBeFalsy()
      expect(screen.queryByText('Confirm password')).toBeFalsy()
    })

    it('correct password calls onUnlock(key, salt, loadedState)', async () => {
      const loaded = initialState()
      vi.mocked(persistModule.peekStoredSalt).mockResolvedValue(fakeSalt)
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(loaded)

      render(<PasswordGate shape="encrypted" onUnlock={onUnlock} onReset={onReset} />)

      fireEvent.change(getPasswordInputs()[0], { target: { value: 'correct-pw' } })
      fireEvent.click(screen.getByRole('button', { name: /unlock/i }))

      await waitFor(() => {
        expect(onUnlock).toHaveBeenCalledWith(fakeKey, fakeSalt, loaded)
      })
    })

    it('incorrect password shows inline error, does not call onUnlock, clears the field, and allows immediate resubmit', async () => {
      vi.mocked(persistModule.peekStoredSalt).mockResolvedValue(fakeSalt)
      vi.mocked(persistModule.loadPersistedApp).mockRejectedValue(new Error('bad key'))

      render(<PasswordGate shape="encrypted" onUnlock={onUnlock} onReset={onReset} />)

      const passwordInput = getPasswordInputs()[0]
      fireEvent.change(passwordInput, { target: { value: 'wrong-pw' } })
      fireEvent.click(screen.getByRole('button', { name: /unlock/i }))

      expect(await screen.findByText('Incorrect password')).toBeTruthy()
      expect(onUnlock).not.toHaveBeenCalled()
      expect(passwordInput.value).toBe('')

      // The submit button must not be disabled/locked out after a failed attempt.
      const unlockButton = screen.getByRole('button', { name: /unlock/i }) as HTMLButtonElement
      expect(unlockButton.disabled).toBe(false)

      // Immediately resubmit with the correct password.
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())
      fireEvent.change(passwordInput, { target: { value: 'correct-pw' } })
      fireEvent.click(unlockButton)

      await waitFor(() => {
        expect(onUnlock).toHaveBeenCalled()
      })
    })
  })

  describe('Reset app', () => {
    it('on the set-password screen: opens confirm dialog, requires typing RESET, then calls clearPersistedApp then onReset', async () => {
      vi.mocked(persistModule.clearPersistedApp).mockResolvedValue(undefined)

      render(<PasswordGate shape="absent" onUnlock={onUnlock} onReset={onReset} />)

      fireEvent.click(screen.getByText('Reset App'))
      expect(screen.getByText('Reset app and erase all data?')).toBeTruthy()

      const eraseButton = screen.getByRole('button', { name: /erase everything/i }) as HTMLButtonElement
      expect(eraseButton.disabled).toBe(true)

      fireEvent.change(screen.getByPlaceholderText('RESET'), { target: { value: 'RESET' } })
      expect(eraseButton.disabled).toBe(false)

      fireEvent.click(eraseButton)

      await waitFor(() => {
        expect(persistModule.clearPersistedApp).toHaveBeenCalled()
        expect(onReset).toHaveBeenCalled()
      })
    })

    it('on the enter-password screen: opens confirm dialog, requires typing RESET, then calls clearPersistedApp then onReset', async () => {
      vi.mocked(persistModule.clearPersistedApp).mockResolvedValue(undefined)

      render(<PasswordGate shape="encrypted" onUnlock={onUnlock} onReset={onReset} />)

      fireEvent.click(screen.getByText('Reset App'))
      fireEvent.change(screen.getByPlaceholderText('RESET'), { target: { value: 'RESET' } })
      fireEvent.click(screen.getByRole('button', { name: /erase everything/i }))

      await waitFor(() => {
        expect(persistModule.clearPersistedApp).toHaveBeenCalled()
        expect(onReset).toHaveBeenCalled()
      })
    })

    it('typing something other than RESET keeps the erase button disabled and does not reset', async () => {
      render(<PasswordGate shape="absent" onUnlock={onUnlock} onReset={onReset} />)

      fireEvent.click(screen.getByText('Reset App'))
      fireEvent.change(screen.getByPlaceholderText('RESET'), { target: { value: 'reset please' } })

      const eraseButton = screen.getByRole('button', { name: /erase everything/i }) as HTMLButtonElement
      expect(eraseButton.disabled).toBe(true)
      expect(persistModule.clearPersistedApp).not.toHaveBeenCalled()
      expect(onReset).not.toHaveBeenCalled()
    })

    it('Cancel closes the confirm dialog without resetting', async () => {
      render(<PasswordGate shape="absent" onUnlock={onUnlock} onReset={onReset} />)

      fireEvent.click(screen.getByText('Reset App'))
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(screen.queryByText('Reset app and erase all data?')).toBeFalsy()
      expect(persistModule.clearPersistedApp).not.toHaveBeenCalled()
      expect(onReset).not.toHaveBeenCalled()
    })

    it('Reset App trigger is present identically on both set-password and enter-password screens', () => {
      const { unmount } = render(
        <PasswordGate shape="absent" onUnlock={onUnlock} onReset={onReset} />
      )
      expect(screen.getByText('Reset App')).toBeTruthy()
      unmount()

      render(<PasswordGate shape="encrypted" onUnlock={onUnlock} onReset={onReset} />)
      expect(screen.getByText('Reset App')).toBeTruthy()
    })
  })
})
