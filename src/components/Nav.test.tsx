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
  // Test case 1: Positions, Register and Quotes are the main nav tabs, in order
  it('renders exactly three main nav tabs, labeled Positions, Register and Quotes, in that order', () => {
    const props = makeProps({ state: { view: 'accounts' } as any })
    render(<Nav {...props} />)

    expect(screen.getByText('Positions')).toBeTruthy()
    expect(screen.getByText('Register')).toBeTruthy()
    expect(screen.getByText('Quotes')).toBeTruthy()
    expect(screen.queryByText('Dashboard')).toBeFalsy()

    const labels = Array.from(document.querySelectorAll('.nav span')).map((el) => el.textContent)
    const order = ['Positions', 'Register', 'Quotes'].map((label) => labels.indexOf(label))
    expect(order[0]).toBeLessThan(order[1])
    expect(order[1]).toBeLessThan(order[2])
  })

  // Test case 2: state.view = 'accounts' → Positions tab is active (accent-100 background)
  it('state.view = "accounts" → Positions tab has active styling', () => {
    const props = makeProps({ state: { view: 'accounts' } as any })
    render(<Nav {...props} />)

    const positionsPill = screen.getByText('Positions').closest('div') as HTMLElement
    expect(positionsPill.style.background).toBe('var(--color-accent-100)')
  })

  // Test case 3: state.view = 'settings' → Positions tab is not active
  it('state.view = "settings" → Positions tab is not active', () => {
    const props = makeProps({ state: { view: 'settings' } as any })
    render(<Nav {...props} />)

    const positionsPill = screen.getByText('Positions').closest('div') as HTMLElement
    expect(positionsPill.style.background).not.toBe('var(--color-accent-100)')
  })

  // Test case 4: Clicking Positions tab
  it('clicking Positions tab dispatches { type: "SET_VIEW", view: "accounts" }', () => {
    const props = makeProps({ state: { view: 'settings' } as any })
    render(<Nav {...props} />)

    fireEvent.click(screen.getByText('Positions'))
    expect(props.dispatch).toHaveBeenCalledWith({ type: 'SET_VIEW', view: 'accounts' })
  })

  // Test case 5a: state.view = 'quotes' → Quotes tab active, Positions tab not active
  it('state.view = "quotes" → Quotes tab has active styling, Positions tab does not', () => {
    const props = makeProps({ state: { view: 'quotes' } as any })
    render(<Nav {...props} />)

    const quotesPill = screen.getByText('Quotes').closest('div') as HTMLElement
    const positionsPill = screen.getByText('Positions').closest('div') as HTMLElement
    expect(quotesPill.style.background).toBe('var(--color-accent-100)')
    expect(positionsPill.style.background).not.toBe('var(--color-accent-100)')
  })

  // Test case 5b: Clicking Quotes tab
  it('clicking Quotes tab dispatches { type: "SET_VIEW", view: "quotes" }', () => {
    const props = makeProps({ state: { view: 'accounts' } as any })
    render(<Nav {...props} />)

    fireEvent.click(screen.getByText('Quotes'))
    expect(props.dispatch).toHaveBeenCalledWith({ type: 'SET_VIEW', view: 'quotes' })
  })

  // Test case 5c: Clicking Register tab
  it('clicking Register tab dispatches { type: "SET_VIEW", view: "register" }', () => {
    const props = makeProps({ state: { view: 'accounts' } as any })
    render(<Nav {...props} />)

    fireEvent.click(screen.getByText('Register'))
    expect(props.dispatch).toHaveBeenCalledWith({ type: 'SET_VIEW', view: 'register' })
  })

  // Test case 5d: state.view = 'register' → Register tab active, others not
  it('state.view = "register" → Register tab has active styling, Positions and Quotes do not', () => {
    const props = makeProps({ state: { view: 'register' } as any })
    render(<Nav {...props} />)

    const registerPill = screen.getByText('Register').closest('div') as HTMLElement
    const positionsPill = screen.getByText('Positions').closest('div') as HTMLElement
    const quotesPill = screen.getByText('Quotes').closest('div') as HTMLElement
    expect(registerPill.style.background).toBe('var(--color-accent-100)')
    expect(positionsPill.style.background).not.toBe('var(--color-accent-100)')
    expect(quotesPill.style.background).not.toBe('var(--color-accent-100)')
  })

  // Test case: logo mark renders
  it('renders the logo mark (plus-icon SVG)', () => {
    const props = makeProps()
    render(<Nav {...props} />)

    expect(screen.getByRole('img', { name: /Ledger logo/i })).toBeTruthy()
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
