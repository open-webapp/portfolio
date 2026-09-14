import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { PasswordGate } from './PasswordGate'
import { initialState } from '../lib/state'
import * as cryptoModule from '../lib/crypto'
import * as persistModule from '../lib/persist'

vi.mock('../lib/crypto', () => ({
  deriveKey: vi.fn(),
  generateSalt: vi.fn(),
  decryptState: vi.fn(),
  encryptState: vi.fn(),
}))

vi.mock('../lib/persist', () => ({
  peekStoredSalt: vi.fn(),
  loadPersistedApp: vi.fn(),
}))

const fakeKey = { fake: 'key' } as unknown as CryptoKey
const fakeSalt = new Uint8Array([1, 2, 3])

// Labels in PasswordGate are plain siblings of their inputs (no htmlFor/id
// association), so getByLabelText can't be used — query by input type instead.
function getPasswordInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll('input[type="password"]'))
}

function renderPasswordGate(props: Partial<React.ComponentProps<typeof PasswordGate>> = {}) {
  const defaults: React.ComponentProps<typeof PasswordGate> = {
    shape: 'absent',
    onUnlock: vi.fn(),
    onBackToPicker: vi.fn(),
    ...props,
  }
  return render(<PasswordGate {...defaults} />)
}

function fillAndSubmitSetPassword(password: string, confirm: string) {
  const [passwordInput, confirmInput] = getPasswordInputs()
  fireEvent.change(passwordInput, { target: { value: password } })
  fireEvent.change(confirmInput, { target: { value: confirm } })
  fireEvent.click(screen.getByRole('button', { name: /set password/i }))
}

describe('PasswordGate', () => {
  const onUnlock = vi.fn()
  const onBackToPicker = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cryptoModule.generateSalt).mockReturnValue(fakeSalt)
    vi.mocked(cryptoModule.deriveKey).mockResolvedValue(fakeKey)
    global.alert = vi.fn()
    global.confirm = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  describe('shape: absent — set-password screen', () => {
    it('renders two password fields and the explanatory note', () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onBackToPicker })

      expect(screen.getByText('New password')).toBeTruthy()
      expect(screen.getByText('Confirm password')).toBeTruthy()
      expect(getPasswordInputs()).toHaveLength(2)
      expect(
        screen.getByText(/never saved anywhere, and you\s+will need to enter it every time/)
      ).toBeTruthy()
    })

    it('shows an inline error and does not call onUnlock when password is under 6 characters', async () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onBackToPicker })

      fillAndSubmitSetPassword('abc', 'abc')

      expect(await screen.findByText('Password must be at least 6 characters')).toBeTruthy()
      expect(onUnlock).not.toHaveBeenCalled()
    })

    it('shows an inline error and does not call onUnlock when confirm password does not match', async () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onBackToPicker })

      fillAndSubmitSetPassword('longenough', 'different')

      expect(await screen.findByText('Passwords do not match')).toBeTruthy()
      expect(onUnlock).not.toHaveBeenCalled()
    })

    it('derives a fresh key/salt and calls onUnlock with no loaded state', async () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onBackToPicker })

      fillAndSubmitSetPassword('longenough', 'longenough')

      await waitFor(() => {
        expect(onUnlock).toHaveBeenCalledWith(fakeKey, fakeSalt)
      })
    })
  })

  describe('shape: encrypted — enter-password screen', () => {
    it('renders a single password field, not two', () => {
      renderPasswordGate({ shape: 'encrypted', onUnlock, onBackToPicker })

      expect(getPasswordInputs()).toHaveLength(1)
      expect(screen.getByText('Password')).toBeTruthy()
      expect(screen.queryByText('New password')).toBeFalsy()
      expect(screen.queryByText('Confirm password')).toBeFalsy()
    })

    it('still renders its subtitle and a single default card wrapper (no tab-seg, no card merge)', () => {
      const { container } = renderPasswordGate({ shape: 'encrypted', onUnlock, onBackToPicker })

      expect(
        screen.getByText('Your data is encrypted on this device. Enter your password to unlock it.')
      ).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'Encryption Password' })).toBeTruthy()
      // Single card wrapper around the unlock form; no restore cards.
      expect(container.querySelectorAll('.card.blueprint.elev-sm')).toHaveLength(1)
      expect(screen.queryByText('Google Drive')).toBeFalsy()
      expect(screen.queryByText('Backup file')).toBeFalsy()
    })

    it('correct password calls onUnlock(key, salt, loadedState)', async () => {
      const loaded = initialState()
      vi.mocked(persistModule.peekStoredSalt).mockResolvedValue(fakeSalt)
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(loaded)

      renderPasswordGate({ shape: 'encrypted', onUnlock, onBackToPicker })

      fireEvent.change(getPasswordInputs()[0], { target: { value: 'correct-pw' } })
      fireEvent.click(screen.getByRole('button', { name: /unlock/i }))

      await waitFor(() => {
        expect(onUnlock).toHaveBeenCalledWith(fakeKey, fakeSalt, loaded)
      })
    })

    it('incorrect password shows inline error, does not call onUnlock, clears the field, and allows immediate resubmit', async () => {
      vi.mocked(persistModule.peekStoredSalt).mockResolvedValue(fakeSalt)
      vi.mocked(persistModule.loadPersistedApp).mockRejectedValue(new Error('bad key'))

      renderPasswordGate({ shape: 'encrypted', onUnlock, onBackToPicker })

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

  describe('Back to portfolios', () => {
    it('renders a "Back to portfolios" control on the set-password screen', () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onBackToPicker })

      expect(screen.getByRole('button', { name: /back to portfolios/i })).toBeTruthy()
    })

    it('renders a "Back to portfolios" control on the enter-password screen', () => {
      renderPasswordGate({ shape: 'encrypted', onUnlock, onBackToPicker })

      expect(screen.getByRole('button', { name: /back to portfolios/i })).toBeTruthy()
    })

    it('clicking it calls onBackToPicker exactly once, synchronously', () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onBackToPicker })

      fireEvent.click(screen.getByRole('button', { name: /back to portfolios/i }))

      expect(onBackToPicker).toHaveBeenCalledTimes(1)
    })

    it('does not show any confirm dialog or RESET-typing UI', () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onBackToPicker })

      fireEvent.click(screen.getByRole('button', { name: /back to portfolios/i }))

      expect(screen.queryByText(/erase all data/i)).toBeFalsy()
      expect(screen.queryByPlaceholderText(/RESET/i)).toBeFalsy()
    })
  })
})
