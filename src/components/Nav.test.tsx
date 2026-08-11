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
    driveReady: false,
    syncing: false,
    handleSync: vi.fn(),
    onOpenSettings: vi.fn(),
    ...rest,
  }
}

describe('Nav', () => {
  // Test case 1: state.view = 'dashboard'
  it('state.view = "dashboard" → Dashboard tab is checked, Accounts tab is not', () => {
    const props = makeProps({ state: { view: 'dashboard' } as any })
    render(<Nav {...props} />)

    const dashboardRadio = screen.getByRole('radio', { name: /Dashboard/i }) as HTMLInputElement
    const accountsRadio = screen.getByRole('radio', { name: /Accounts/i }) as HTMLInputElement

    expect(dashboardRadio.checked).toBe(true)
    expect(accountsRadio.checked).toBe(false)
  })

  // Test case 2: state.view = 'accounts'
  it('state.view = "accounts" → Accounts tab is checked, Dashboard tab is not', () => {
    const props = makeProps({ state: { view: 'accounts' } as any })
    render(<Nav {...props} />)

    const dashboardRadio = screen.getByRole('radio', { name: /Dashboard/i }) as HTMLInputElement
    const accountsRadio = screen.getByRole('radio', { name: /Accounts/i }) as HTMLInputElement

    expect(accountsRadio.checked).toBe(true)
    expect(dashboardRadio.checked).toBe(false)
  })

  // Test case 3: state.view = 'settings'
  it('state.view = "settings" → neither Dashboard nor Accounts tab is checked', () => {
    const props = makeProps({ state: { view: 'settings' } as any })
    render(<Nav {...props} />)

    const dashboardRadio = screen.getByRole('radio', { name: /Dashboard/i }) as HTMLInputElement
    const accountsRadio = screen.getByRole('radio', { name: /Accounts/i }) as HTMLInputElement

    expect(dashboardRadio.checked).toBe(false)
    expect(accountsRadio.checked).toBe(false)
  })

  // Test case 4: Clicking Dashboard tab
  it('clicking Dashboard tab dispatches { type: "SET_VIEW", view: "dashboard" }', () => {
    const props = makeProps({ state: { view: 'accounts' } as any })
    render(<Nav {...props} />)

    fireEvent.click(screen.getByLabelText('Dashboard'))
    expect(props.dispatch).toHaveBeenCalledWith({ type: 'SET_VIEW', view: 'dashboard' })
  })

  // Test case 5: Clicking Accounts tab
  it('clicking Accounts tab dispatches { type: "SET_VIEW", view: "accounts" }', () => {
    const props = makeProps({ state: { view: 'dashboard' } as any })
    render(<Nav {...props} />)

    fireEvent.click(screen.getByLabelText('Accounts'))
    expect(props.dispatch).toHaveBeenCalledWith({ type: 'SET_VIEW', view: 'accounts' })
  })

  // Test case 6a: driveReady = true → sync icon renders
  it('driveReady = true → sync icon renders with title="Sync now"', () => {
    const props = makeProps({ driveReady: true })
    render(<Nav {...props} />)

    expect(screen.getByTitle('Sync now')).toBeTruthy()
  })

  // Test case 6b: driveReady = false → sync icon does not render
  it('driveReady = false → sync icon does not render', () => {
    const props = makeProps({ driveReady: false })
    render(<Nav {...props} />)

    expect(screen.queryByTitle('Sync now')).toBeFalsy()
  })

  // Test case 7: driveReady = true, syncing = true → sync icon is disabled
  it('driveReady = true, syncing = true → sync icon is disabled', () => {
    const props = makeProps({ driveReady: true, syncing: true })
    render(<Nav {...props} />)

    const syncButton = screen.getByTitle('Sync now') as HTMLButtonElement
    expect(syncButton.disabled).toBe(true)
  })

  // Test case 8: Clicking sync icon calls handleSync
  it('clicking sync icon calls handleSync mock', () => {
    const props = makeProps({ driveReady: true })
    render(<Nav {...props} />)

    fireEvent.click(screen.getByTitle('Sync now'))
    expect(props.handleSync).toHaveBeenCalledTimes(1)
  })

  // Test case 9: Clicking gear icon calls onOpenSettings
  it('clicking gear icon calls onOpenSettings mock', () => {
    const props = makeProps()
    render(<Nav {...props} />)

    fireEvent.click(screen.getByTitle('Settings'))
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })
})
