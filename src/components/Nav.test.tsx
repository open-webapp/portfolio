import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { RailNav, TopBar } from './Nav'
import { initialState } from '../lib/state'

const styles = readFileSync('src/styles/styles.css', 'utf8')

afterEach(() => {
  cleanup()
})

function makeRailProps(overrides: Partial<React.ComponentProps<typeof RailNav>> = {}) {
  const { state: stateOverride, ...rest } = overrides
  return {
    state: { ...initialState(), ...stateOverride },
    dispatch: vi.fn(),
    connected: false,
    syncing: false,
    handleSync: vi.fn(),
    onOpenSettings: vi.fn(),
    onSwitchPortfolio: vi.fn(),
    ...rest,
  }
}

function makeTopBarProps(overrides: Partial<React.ComponentProps<typeof TopBar>> = {}) {
  return {
    ...overrides,
  }
}

describe('RailNav', () => {
  it('places switch portfolio last, directly below settings', () => {
    const props = makeRailProps()
    render(<RailNav {...props} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons[0].getAttribute('aria-label')).toBe('Budget')
    expect(buttons.at(-2)?.getAttribute('aria-label')).toBe('Settings')
    expect(buttons.at(-1)?.getAttribute('aria-label')).toBe('Switch portfolio')

    fireEvent.click(buttons.at(-1)!)
    expect(props.onSwitchPortfolio).toHaveBeenCalledOnce()
  })

  it('renders switch portfolio as an exit door+arrow glyph distinct from sync', () => {
    const props = makeRailProps()
    render(<RailNav {...props} />)

    const switchButton = screen.getByRole('button', { name: 'Switch portfolio' })
    expect(switchButton.classList.contains('rail-exit')).toBe(true)
    const paths = Array.from(switchButton.querySelectorAll('path')).map((p) => p.getAttribute('d'))
    expect(paths).toContain('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4')
    expect(paths).toContain('m16 17 5-5-5-5')
    expect(paths).toContain('M21 12H9')
    // Circular sync arrows must not leak into the switch glyph.
    expect(paths.some((d) => d?.includes('M21 2v6h-6'))).toBe(false)
  })

  it.each([
    ['Budget', 'budget'],
    ['Positions', 'accounts'],
    ['Register', 'register'],
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

  it('hides Sync while idle and disconnected', () => {
    render(<RailNav {...makeRailProps()} />)

    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull()
  })

  it('syncs when connected and idle', () => {
    const props = makeRailProps({ connected: true })
    render(<RailNav {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(props.handleSync).toHaveBeenCalledOnce()
  })

  it('keeps an in-progress sync visible and disabled after disconnection', () => {
    const props = makeRailProps({ syncing: true })
    render(<RailNav {...props} />)

    const syncButton = screen.getByRole('button', { name: 'Syncing' })
    expect(syncButton.disabled).toBe(true)
    expect(syncButton.getAttribute('title')).toBe('Syncing')
    expect(syncButton.querySelector('svg')?.classList.contains('syncing')).toBe(true)

    fireEvent.click(syncButton)
    expect(props.handleSync).not.toHaveBeenCalled()
  })

  it('keeps mobile rail ordering and spinner animation scoped to their hooks', () => {
    expect(styles).toMatch(/@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.rail\s*\{[^}]*flex-direction:\s*row/s)
    expect(styles).toMatch(/\.rail-items\s*\{[^}]*flex-direction:\s*row[^}]*\}/s)
    expect(styles).toMatch(/\.rail-exit\s*\{[^}]*background:\s*#f59e0b[^}]*\}/s)
    expect(styles).toMatch(/\.rail-exit:hover\s*\{[^}]*background:\s*#d97706[^}]*\}/s)
    expect(styles).toMatch(/\.syncing\s*\{[^}]*animation:\s*sync-spin\s+0\.8s\s+linear\s+infinite[^}]*\}/s)
    expect(styles).toMatch(/@keyframes\s+sync-spin\s*\{[^}]*transform:\s*rotate\(360deg\)/s)
  })
})

describe('TopBar', () => {
  it('contains the supplied period control and no portfolio or Sync controls', () => {
    render(<TopBar {...makeTopBarProps()} periodControl={<div data-testid="period-control">This month</div>} />)

    const topBar = document.querySelector('.top-bar')
    expect(topBar?.querySelector('[data-testid="period-control"]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /portfolio|sync/i })).toBeNull()
  })

  it('renders a blank top bar without a period control', () => {
    render(<TopBar {...makeTopBarProps()} />)

    const topBar = document.querySelector('.top-bar')
    expect(topBar).toBeTruthy()
    expect(topBar?.childElementCount).toBe(0)
    expect(screen.queryByRole('button', { name: /portfolio|sync/i })).toBeNull()
  })
})
