import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RailNav, TopBar } from './Nav'
import { initialState } from '../lib/state'

afterEach(() => {
  cleanup()
})

function makeRailProps(overrides: Partial<React.ComponentProps<typeof RailNav>> = {}) {
  const { state: stateOverride, ...rest } = overrides
  return {
    state: { ...initialState(), ...stateOverride },
    dispatch: vi.fn(),
    onOpenSettings: vi.fn(),
    ...rest,
  }
}

function makeTopBarProps(overrides: Partial<React.ComponentProps<typeof TopBar>> = {}) {
  return {
    connected: false,
    syncing: false,
    handleSync: vi.fn(),
    onSwitchPortfolio: vi.fn(),
    portfolioName: 'Test Portfolio',
    ...overrides,
  }
}

describe('RailNav', () => {
  it('renders four rail items and a settings button', () => {
    render(<RailNav {...makeRailProps()} />)

    expect(screen.getAllByRole('button')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
  })

  it.each([
    ['Budget', 'budget'],
    ['Positions', 'accounts'],
    ['Register', 'register'],
    ['Quotes', 'quotes'],
  ])('dispatches SET_VIEW for %s', (label, view) => {
    const props = makeRailProps()
    render(<RailNav {...props} />)

    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(props.dispatch).toHaveBeenCalledWith({ type: 'SET_VIEW', view })
  })

  it('opens settings from the settings button', () => {
    const props = makeRailProps()
    render(<RailNav {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(props.onOpenSettings).toHaveBeenCalledOnce()
  })
})

describe('TopBar', () => {
  it('renders the period control inside the top bar', () => {
    render(<TopBar {...makeTopBarProps()} periodControl={<div data-testid="period-control">This month</div>} />)

    const topBar = document.querySelector('.top-bar')
    expect(topBar?.querySelector('[data-testid="period-control"]')).toBeTruthy()
  })

  it('renders without a period control', () => {
    render(<TopBar {...makeTopBarProps()} />)

    expect(document.querySelector('.top-bar')).toBeTruthy()
    expect(screen.queryByTestId('period-control')).toBeNull()
  })
})
