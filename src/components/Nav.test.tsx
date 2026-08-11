import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Nav } from './Nav'
import { initialState } from '../lib/state'

afterEach(() => {
  cleanup()
})

function makeProps(overrides: Partial<React.ComponentProps<typeof Nav>> = {}) {
  const { state: stateOverride, ...rest } = overrides
  const state = { ...initialState(), ...(stateOverride ?? {}) }
  return {
    state,
    dispatch: vi.fn(),
    settingsSection: 'drive' as const,
    setSettingsSection: vi.fn(),
    driveReady: false,
    syncing: false,
    handleSync: vi.fn(),
    onOpenSettings: vi.fn(),
    ...rest,
  }
}

describe('Nav', () => {
  it('renders category tabs and not settings tabs when view is dashboard', () => {
    const props = makeProps({ state: { view: 'dashboard' } as any })
    render(<Nav {...props} />)

    expect(screen.getByText('All')).toBeTruthy()
    expect(screen.getByText('Taxable')).toBeTruthy()
    expect(screen.getByText('Non-Taxable')).toBeTruthy()
    expect(screen.getByText('Tax-Deferred')).toBeTruthy()

    expect(screen.queryByText('Google Drive')).toBeFalsy()
    expect(screen.queryByText('Encryption')).toBeFalsy()
  })

  it('renders settings tabs and not category tabs when view is settings', () => {
    const props = makeProps({ state: { view: 'settings' } as any })
    render(<Nav {...props} />)

    expect(screen.getByText('Google Drive')).toBeTruthy()
    expect(screen.getByText('Encryption')).toBeTruthy()

    expect(screen.queryByText('All')).toBeFalsy()
    expect(screen.queryByText('Taxable')).toBeFalsy()
    expect(screen.queryByText('Non-Taxable')).toBeFalsy()
    expect(screen.queryByText('Tax-Deferred')).toBeFalsy()
  })

  it('renders the sync icon button when driveReady is true', () => {
    const props = makeProps({ driveReady: true })
    render(<Nav {...props} />)

    expect(screen.getByTitle('Sync now')).toBeTruthy()
  })

  it('does not render the sync icon button when driveReady is false', () => {
    const props = makeProps({ driveReady: false })
    render(<Nav {...props} />)

    expect(screen.queryByTitle('Sync now')).toBeFalsy()
  })

  it('disables the sync icon button when syncing is true', () => {
    const props = makeProps({ driveReady: true, syncing: true })
    render(<Nav {...props} />)

    const syncButton = screen.getByTitle('Sync now') as HTMLButtonElement
    expect(syncButton.disabled).toBe(true)
  })

  it('calls handleSync when the sync icon is clicked', () => {
    const props = makeProps({ driveReady: true })
    render(<Nav {...props} />)

    fireEvent.click(screen.getByTitle('Sync now'))
    expect(props.handleSync).toHaveBeenCalledTimes(1)
  })

  it('calls onOpenSettings when the gear icon is clicked', () => {
    const props = makeProps()
    render(<Nav {...props} />)

    fireEvent.click(screen.getByTitle('Settings'))
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('calls setSettingsSection with the right value when a settings tab is clicked', () => {
    const props = makeProps({ state: { view: 'settings' } as any })
    render(<Nav {...props} />)

    fireEvent.click(screen.getByText('Google Drive'))
    expect(props.setSettingsSection).toHaveBeenCalledWith('drive')

    fireEvent.click(screen.getByText('Encryption'))
    expect(props.setSettingsSection).toHaveBeenCalledWith('encryption')
  })
})
