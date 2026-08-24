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
  // Test case 1: Positions and Quotes are the main nav tabs
  it('renders exactly two main nav tabs, labeled Positions and Quotes', () => {
    const props = makeProps({ state: { view: 'accounts' } as any })
    render(<Nav {...props} />)

    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByRole('radio', { name: /Positions/i })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Quotes/i })).toBeTruthy()
    expect(screen.queryByText('Dashboard')).toBeFalsy()
  })

  // Test case 2: state.view = 'accounts'
  it('state.view = "accounts" → Positions tab is checked', () => {
    const props = makeProps({ state: { view: 'accounts' } as any })
    render(<Nav {...props} />)

    const accountsRadio = screen.getByRole('radio', { name: /Positions/i }) as HTMLInputElement
    expect(accountsRadio.checked).toBe(true)
  })

  // Test case 3: state.view = 'settings'
  it('state.view = "settings" → Positions tab is not checked', () => {
    const props = makeProps({ state: { view: 'settings' } as any })
    render(<Nav {...props} />)

    const accountsRadio = screen.getByRole('radio', { name: /Positions/i }) as HTMLInputElement
    expect(accountsRadio.checked).toBe(false)
  })

  // Test case 4: Clicking Positions tab
  it('clicking Positions tab dispatches { type: "SET_VIEW", view: "accounts" }', () => {
    const props = makeProps({ state: { view: 'settings' } as any })
    render(<Nav {...props} />)

    fireEvent.click(screen.getByLabelText('Positions'))
    expect(props.dispatch).toHaveBeenCalledWith({ type: 'SET_VIEW', view: 'accounts' })
  })

  // Test case 5a: state.view = 'quotes'
  it('state.view = "quotes" → Quotes tab is checked, Positions tab is not checked', () => {
    const props = makeProps({ state: { view: 'quotes' } as any })
    render(<Nav {...props} />)

    const quotesRadio = screen.getByRole('radio', { name: /Quotes/i }) as HTMLInputElement
    const accountsRadio = screen.getByRole('radio', { name: /Positions/i }) as HTMLInputElement
    expect(quotesRadio.checked).toBe(true)
    expect(accountsRadio.checked).toBe(false)
  })

  // Test case 5b: Clicking Quotes tab
  it('clicking Quotes tab dispatches { type: "SET_VIEW", view: "quotes" }', () => {
    const props = makeProps({ state: { view: 'accounts' } as any })
    render(<Nav {...props} />)

    fireEvent.click(screen.getByLabelText('Quotes'))
    expect(props.dispatch).toHaveBeenCalledWith({ type: 'SET_VIEW', view: 'quotes' })
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
