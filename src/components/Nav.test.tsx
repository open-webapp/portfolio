import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Nav } from './Nav'
import { initialState } from '../lib/state'

afterEach(() => {
  cleanup()
})

function makeProps(overrides: Partial<React.ComponentProps<typeof Nav>> = {}) {
  const { state: stateOverride, ...rest } = overrides
  const state = { ...initialState(), ...stateOverride }
  return {
    state,
    dispatch: vi.fn(),
    connected: false,
    syncing: false,
    handleSync: vi.fn(),
    onOpenSettings: vi.fn(),
    portfolioName: 'Test Portfolio',
    onSwitchPortfolio: vi.fn(),
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

  // Test case 6a: connected = true → sync icon renders and is enabled
  it('connected = true → sync icon renders with title="Sync now" and is enabled', () => {
    const props = makeProps({ connected: true })
    render(<Nav {...props} />)

    const syncButton = screen.getByTitle('Sync now') as HTMLButtonElement
    expect(syncButton).toBeTruthy()
    expect(syncButton.disabled).toBe(false)
  })

  // Test case 6b: connected = false → sync icon still renders but is disabled,
  // and clicking it does not call handleSync
  it('connected = false → sync icon renders but is disabled and does not call handleSync when clicked', () => {
    const props = makeProps({ connected: false })
    render(<Nav {...props} />)

    const syncButton = screen.getByTitle('Sync now') as HTMLButtonElement
    expect(syncButton).toBeTruthy()
    expect(syncButton.disabled).toBe(true)

    fireEvent.click(syncButton)
    expect(props.handleSync).not.toHaveBeenCalled()
  })

  // Test case 7: connected = true, syncing = true → sync icon is disabled
  it('connected = true, syncing = true → sync icon is disabled', () => {
    const props = makeProps({ connected: true, syncing: true })
    render(<Nav {...props} />)

    const syncButton = screen.getByTitle('Sync now') as HTMLButtonElement
    expect(syncButton.disabled).toBe(true)
  })

  // Test case 8: Clicking sync icon (connected, not syncing) calls handleSync
  it('clicking sync icon calls handleSync mock when connected', () => {
    const props = makeProps({ connected: true })
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

  // Test case 10a: renders portfolioName text instead of "Ledger"
  it('renders portfolioName text instead of "Ledger"', () => {
    const props = makeProps()
    render(<Nav {...props} />)

    expect(screen.queryByText('Ledger')).toBeFalsy()
    expect(screen.getByText('Test Portfolio')).toBeTruthy()
  })

  // Test case 10b: portfolio-name element is a button with title="Switch portfolio"
  it('portfolio-name element is a button with title="Switch portfolio"', () => {
    const props = makeProps()
    render(<Nav {...props} />)

    const brandButton = screen.getByTitle('Switch portfolio')
    expect(brandButton).toBeTruthy()
    expect(brandButton.tagName).toBe('BUTTON')
  })

  // Test case 10c: clicking it calls onSwitchPortfolio
  it('clicking the portfolio name button calls onSwitchPortfolio', () => {
    const props = makeProps()
    render(<Nav {...props} />)

    fireEvent.click(screen.getByTitle('Switch portfolio'))
    expect(props.onSwitchPortfolio).toHaveBeenCalledTimes(1)
  })

  // Test case 10d: old icon button (capital P title) is gone
  it('old "Switch Portfolio" icon button is gone', () => {
    const props = makeProps()
    render(<Nav {...props} />)

    expect(screen.queryByTitle('Switch Portfolio')).toBeFalsy()
  })
})
