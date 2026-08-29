import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { SyncConflictDialog } from './SyncConflictDialog'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function noopAsync() {
  return Promise.resolve()
}

function renderDialog(overrides?: Partial<Parameters<typeof SyncConflictDialog>[0]>) {
  const props = {
    remoteModifiedTime: undefined as string | undefined,
    localRestoredAt: undefined as string | undefined,
    onOverwriteLocalWithRemote: vi.fn(noopAsync),
    onOverwriteRemoteWithLocal: vi.fn(noopAsync),
    onCancel: vi.fn(),
    ...overrides,
  }
  render(<SyncConflictDialog {...props} />)
  return props
}

const btn = (name: RegExp | string) => screen.getByRole('button', { name }) as HTMLButtonElement

describe('SyncConflictDialog', () => {
  it('renders all three button labels', () => {
    renderDialog()
    expect(btn('Overwrite local with remote')).toBeTruthy()
    expect(btn('Overwrite remote with local')).toBeTruthy()
    expect(btn('Cancel')).toBeTruthy()
  })

  it('renders formatted timestamp strings when provided', () => {
    const remote = '2026-08-20T10:00:00.000Z'
    const local = '2026-08-19T08:30:00.000Z'
    renderDialog({ remoteModifiedTime: remote, localRestoredAt: local })
    expect(screen.getByText(`Remote backup updated: ${new Date(remote).toLocaleString()}`)).toBeTruthy()
    expect(screen.getByText(`Local copy restored: ${new Date(local).toLocaleString()}`)).toBeTruthy()
  })

  it('formats localRestoredAt when given as epoch-ms (drive-sync surfaces it that way)', () => {
    const localMs = Date.parse('2026-08-19T08:30:00.000Z')
    renderDialog({ localRestoredAt: localMs })
    expect(
      screen.getByText(`Local copy restored: ${new Date(localMs).toLocaleString()}`)
    ).toBeTruthy()
  })

  it('renders an em dash when timestamps are omitted', () => {
    renderDialog()
    expect(screen.getByText('Remote backup updated: —')).toBeTruthy()
    expect(screen.getByText('Local copy restored: —')).toBeTruthy()
  })

  it('renders an em dash when a timestamp is unparseable', () => {
    renderDialog({ remoteModifiedTime: 'not-a-date' })
    expect(screen.getByText('Remote backup updated: —')).toBeTruthy()
  })

  it('calls onOverwriteLocalWithRemote exactly once when its button is clicked', async () => {
    const props = renderDialog()
    fireEvent.click(btn('Overwrite local with remote'))
    await waitFor(() => expect(props.onOverwriteLocalWithRemote).toHaveBeenCalledTimes(1))
    expect(props.onOverwriteRemoteWithLocal).not.toHaveBeenCalled()
  })

  it('calls onOverwriteRemoteWithLocal exactly once when its button is clicked', async () => {
    const props = renderDialog()
    fireEvent.click(btn('Overwrite remote with local'))
    await waitFor(() => expect(props.onOverwriteRemoteWithLocal).toHaveBeenCalledTimes(1))
    expect(props.onOverwriteLocalWithRemote).not.toHaveBeenCalled()
  })

  it('calls onCancel when Cancel is clicked', () => {
    const props = renderDialog()
    fireEvent.click(btn('Cancel'))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('disables all buttons while an overwrite prop promise is pending', async () => {
    let resolve!: () => void
    const pending = () => new Promise<void>((r) => { resolve = r })
    renderDialog({ onOverwriteLocalWithRemote: vi.fn(pending) })

    fireEvent.click(btn('Overwrite local with remote'))

    await waitFor(() => {
      expect(btn('Overwrite local with remote').disabled).toBe(true)
      expect(btn('Overwrite remote with local').disabled).toBe(true)
      expect(btn('Cancel').disabled).toBe(true)
    })

    resolve()
    await waitFor(() => expect(btn('Cancel').disabled).toBe(false))
  })

  it('shows the cross-password copy when an overwrite prop rejects with DriveDecryptError', async () => {
    const rejectDecrypt = () => Promise.reject(Object.assign(new Error('nope'), { name: 'DriveDecryptError' }))
    renderDialog({ onOverwriteLocalWithRemote: vi.fn(rejectDecrypt) })

    fireEvent.click(btn('Overwrite local with remote'))

    await waitFor(() => {
      expect(screen.getByText(/different password/i)).toBeTruthy()
      expect(screen.getByText(/Settings > Drive/i)).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows a generic inline error when an overwrite prop rejects with a plain Error', async () => {
    const rejectPlain = () => Promise.reject(new Error('boom'))
    renderDialog({ onOverwriteRemoteWithLocal: vi.fn(rejectPlain) })

    fireEvent.click(btn('Overwrite remote with local'))

    await waitFor(() => {
      expect(screen.getByText(/Drive changed again/i)).toBeTruthy()
    })
    expect(screen.queryByText(/different password/i)).toBeNull()
  })
})
