import { useReducer, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PositionGroupOverlay } from './PositionGroupOverlay'
import { initialState } from '../lib/state'
import { appReducer } from '../lib/reducer'
import type { Account, Position } from '../lib/types'
import type { AppState } from '../lib/state'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const accounts: Account[] = [
  { id: 'a', institution: 'Alpha', name: 'Brokerage', accountNumber: '1', taxCategory: 'taxable', retirement: false, createdAt: '' },
  { id: 'b', institution: 'Beta', name: 'IRA', accountNumber: '2', taxCategory: 'taxDeferred', retirement: true, createdAt: '' },
]
const lots: Position[] = [
  { id: 'one', accountId: 'a', symbol: 'ABC', trackingSymbol: 'TRACK', name: 'Example', assetClass: 'Equity', shares: 10, avgCost: 8, price: 20, lastImportedAt: '' },
  { id: 'two', accountId: 'a', symbol: 'ABC', trackingSymbol: 'TRACK', name: 'Example', assetClass: 'Equity', shares: 30, avgCost: 12, price: 20, lastImportedAt: '' },
]
function Harness() {
  const [state, dispatch] = useReducer(appReducer, { ...initialState(), accounts, positions: lots, positionsTab: 'taxable' })
  const [open, setOpen] = useState(true)
  return <>
    <output data-testid="state">{JSON.stringify(state.positions)}</output>
    <output data-testid="account-total">{state.positions.filter(p => p.accountId === 'a').reduce((n, p) => n + p.shares * p.price, 0)}</output>
    {open && <PositionGroupOverlay positions={state.positions} accounts={accounts} dispatch={dispatch} onClose={() => setOpen(false)} existingAssetClasses={['Equity', 'Bond']} state={state} />}
  </>
}
const result = () => JSON.parse(screen.getByTestId('state').textContent!) as Position[]
function edit(label: string, draft: string, finish: string) {
  fireEvent.click(screen.getByRole('button', { name: `Edit ${label}` }))
  const input = screen.getByRole(label === 'Current Price' ? 'spinbutton' : 'textbox', { name: label })
  fireEvent.change(input, { target: { value: draft } })
  if (finish === 'blur') fireEvent.blur(input)
  else fireEvent.keyDown(input, { key: finish })
}
describe('shared header and lots', () => {
  for (const [label, field, draft, expected] of [
    ['Symbol', 'symbol', 'XYZ', 'XYZ'], ['Tracking Symbol', 'trackingSymbol', 'OTHER', 'OTHER'],
    ['Name', 'name', 'Updated', 'Updated'], ['Current Price', 'price', '25', 25],
  ] as const) {
    for (const finish of ['Enter', 'blur']) it(`${label} commits all lots on ${finish}`, () => {
      render(<Harness />); edit(label, draft, finish)
      expect(result().map(p => p[field])).toEqual([expected, expected])
      expect(screen.getByRole('dialog')).toBeTruthy()
    })
    it(`${label} Escape reverts without closing overlay`, () => {
      render(<Harness />); edit(label, draft, 'Escape')
      expect(result()).toEqual(lots)
      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.queryByRole('textbox', { name: label })).toBeNull()
    })
  }
  for (const draft of ['', '-1', 'invalid', '1e309']) it(`rejects price ${JSON.stringify(draft)}`, () => {
    render(<Harness />); edit('Current Price', draft, 'blur')
    expect(result()).toEqual(lots)
    expect(screen.getByRole('button', { name: 'Edit Current Price' }).textContent).toBe('$20.00')
  })
  it('clears tracking symbol', () => {
    render(<Harness />); edit('Tracking Symbol', '', 'Enter')
    expect(result().map(p => p.trackingSymbol)).toEqual([undefined, undefined])
  })
  it('changes shared asset class override', () => {
    render(<Harness />); fireEvent.click(screen.getByText('Set')); fireEvent.click(screen.getByText('Bond'))
    expect(result().map(p => p.assetClassManualOverride)).toEqual(['Bond', 'Bond'])
  })
  it('shows literal lot columns', () => {
    render(<Harness />)
    expect(screen.getAllByRole('columnheader').map(e => e.textContent)).toEqual(['Account', 'Shares', 'Avg Cost', 'Market Value', '% of Portfolio', 'Close', 'Delete'])
    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]).getAllByRole('cell').slice(1, 5).map(e => e.textContent)).toEqual(['10.00', '$8.00', '$200.00', '25.0%'])
    expect(within(rows[1]).getAllByRole('cell').slice(1, 5).map(e => e.textContent)).toEqual(['30.00', '$12.00', '$600.00', '75.0%'])
  })
  it('reassigns a lot across tabs and updates account total', () => {
    render(<Harness />)
    fireEvent.change(screen.getAllByRole('combobox', { name: /Account/ })[0], { target: { value: 'b' } })
    expect(result()[0].accountId).toBe('b')
    expect(screen.getByTestId('account-total').textContent).toBe('600')
    expect(screen.getAllByRole('combobox', { name: /Account/ }).some(e => (e as HTMLSelectElement).value === 'b')).toBe(true)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
  it('delete updates totals and percentages; last delete closes overlay', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Harness />); fireEvent.click(screen.getAllByRole('button', { name: 'Delete this position' })[0])
    expect(result().map(p => p.id)).toEqual(['two'])
    expect(screen.getByTestId('account-total').textContent).toBe('600')
    expect(screen.getByText('100.0%')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete this position' }))
    expect(result()).toEqual([]); expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('cancel delete preserves lots', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Harness />); fireEvent.click(screen.getAllByRole('button', { name: 'Delete this position' })[0])
    expect(result()).toEqual(lots)
  })
})

const saleLot = (patch: Partial<Position> = {}): Position => ({ id: 'lot-1', accountId: 'a', symbol: 'ACME', name: 'Acme', assetClass: 'Equity', shares: 10, avgCost: 100, price: 120, lastImportedAt: '2026-01-01', ...patch })
function SaleHarness({ positions = [saleLot()], transactions = [] }: { positions?: Position[]; transactions?: AppState['transactions'] }) {
  const [state, dispatch] = useReducer(appReducer, { ...initialState(), accounts, positions, transactions })
  const [open, setOpen] = useState(true)
  return <><output data-testid="sale-state">{JSON.stringify(state)}</output>{open && <PositionGroupOverlay positions={state.positions} accounts={accounts} dispatch={dispatch} onClose={() => setOpen(false)} existingAssetClasses={[]} state={state} />}</>
}
const saleState = () => JSON.parse(screen.getByTestId('sale-state').textContent!) as AppState
const openSale = (index = 0) => fireEvent.click(screen.getAllByRole('button', { name: 'Close', exact: true }).filter(b => b.classList.contains('btn-ghost'))[index])
describe('inline lot close', () => {
  it('lays out sale fields beside a separate Result card with horizontal actions', () => {
    render(<SaleHarness />); openSale()
    const panel = screen.getByRole('region', { name: 'Close lot lot-1' })
    const cards = panel.querySelectorAll<HTMLElement>('.card')
    expect(cards).toHaveLength(2)
    const columns = cards[0].parentElement!
    expect(columns.style.display).toBe('grid')
    expect(columns.style.gridTemplateColumns).toBe('minmax(0, 1fr) minmax(280px, 360px)')
    expect(columns.style.gap).toBe('24px')
    expect(within(cards[0]).getByText('Alpha — Brokerage')).toBeTruthy()
    const fields = within(cards[0]).getByLabelText('Shares').closest('.field')!.parentElement!
    expect(fields.style.display).toBe('grid')
    expect(fields.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(180px, 1fr))')
    expect(fields.style.gap).toBe('16px')
    expect(fields.querySelectorAll('.field')).toHaveLength(4)
    expect(within(cards[1]).getByText('Result')).toBeTruthy()
    expect(within(cards[1]).getByText('$200.00')).toBeTruthy()
    expect(cards[1].contains(screen.getByLabelText('Shares'))).toBe(false)
    const actions = within(panel).getByRole('button', { name: 'Cancel' }).parentElement!
    expect(actions.style.display).toBe('flex')
    expect(actions.style.justifyContent).toBe('flex-end')
    expect(actions.contains(within(panel).getByRole('button', { name: 'Close position' }))).toBe(true)
  })
  it('opens only on lot Close, defaults all shares/current price/today/zero fees, without a lot selector', () => {
    render(<SaleHarness />)
    expect(screen.queryByLabelText('Sale price')).toBeNull()
    openSale()
    expect((screen.getByLabelText('Shares') as HTMLInputElement).value).toBe('10')
    expect((screen.getByLabelText('Sale price') as HTMLInputElement).value).toBe('120')
    expect((screen.getByLabelText('Fees') as HTMLInputElement).value).toBe('0')
    expect((screen.getByLabelText('Sale date') as HTMLInputElement).value).toBe(new Date().toISOString().slice(0, 10))
    expect(screen.queryByLabelText('Position lot')).toBeNull()
  })
  it('selects another lot through its Close button and resets defaults', () => {
    render(<SaleHarness positions={[saleLot(), saleLot({ id: 'lot-2', avgCost: 90, shares: 5 })]} />)
    openSale(); fireEvent.change(screen.getByLabelText('Fees'), { target: { value: '5' } }); openSale(1)
    expect((screen.getByLabelText('Shares') as HTMLInputElement).value).toBe('5')
    expect((screen.getByLabelText('Fees') as HTMLInputElement).value).toBe('0')
    expect(screen.getByText('$150.00')).toBeTruthy()
  })
  it('preserves old realized preview literals and shows net proceeds', () => {
    render(<SaleHarness />); openSale()
    fireEvent.change(screen.getByLabelText('Fees'), { target: { value: '5' } })
    expect(screen.getByText('$195.00')).toBeTruthy()
    expect(screen.getByText('$1,195.00')).toBeTruthy()
    expect(screen.getByText('19.50%')).toBeTruthy()
  })
  it('renders hand-computed proceeds 115, realized 15/15%, cost 100, remaining zero', () => {
    render(<SaleHarness positions={[saleLot({ avgCost: 10, price: 12 })]} />); openSale()
    fireEvent.change(screen.getByLabelText('Fees'), { target: { value: '5' } })
    for (const literal of ['$115.00', '$15.00', '15.00%', '$100.00', '0.00 shares']) expect(screen.getByText(literal)).toBeTruthy()
  })
  it.each([
    ['Shares', '0', 'Enter shares greater than 0.'], ['Shares', '-1', 'Enter shares greater than 0.'],
    ['Shares', '11', 'You only hold 10 shares'], ['Sale price', '-1', 'Enter a non-negative sale price.'],
    ['Sale price', '0', 'Enter a sale price greater than 0.'], ['Sale date', '', 'Enter a sale date.'],
    ['Fees', '-1', 'Enter non-negative fees.'],
  ])('rejects %s = %s without changing state', (label, value, message) => {
    render(<SaleHarness />); const before = saleState(); openSale()
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
    expect(screen.getByRole('alert').textContent).toBe(message)
    expect((screen.getByRole('button', { name: 'Close position' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Close position' }))
    expect(saleState()).toEqual(before)
  })
  it('Cancel removes the panel and preserves state', () => {
    render(<SaleHarness />); const before = saleState(); openSale()
    fireEvent.change(screen.getByLabelText('Shares'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Sale price')).toBeNull(); expect(saleState()).toEqual(before)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
  it('full sale with no prior Sell creates a linked transaction and known realized basis', () => {
    render(<SaleHarness />); openSale()
    fireEvent.change(screen.getByLabelText('Sale date'), { target: { value: '2026-02-03' } })
    fireEvent.change(screen.getByLabelText('Fees'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close position' }))
    const state = saleState()
    expect(state.positions).toEqual([])
    expect(state.transactions).toHaveLength(1)
    expect(state.transactions[0]).toMatchObject({ accountId: 'a', symbol: 'ACME', type: 'Sell', date: '2026-02-03', shares: 10, price: 120, amount: 1195 })
    expect(state.closedPositions[0]).toMatchObject({ symbol: 'ACME', shares: 10, realizedGL: 195, realizedGLBasis: 'transactions', sellTransactionId: state.transactions[0].id })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('partial sale leaves six shares and closes only the panel', () => {
    render(<SaleHarness />); openSale()
    fireEvent.change(screen.getByLabelText('Shares'), { target: { value: '4' } })
    expect(screen.getByText('6.00 shares')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close position' }))
    expect(saleState().positions).toEqual([saleLot({ shares: 6 })])
    expect(saleState().closedPositions[0].shares).toBe(4)
    expect(screen.queryByLabelText('Sale price')).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
  it('reuses an equivalent imported Sell instead of duplicating it', () => {
    const transaction = { id: 'imported-sell', accountId: 'a', symbol: 'ACME', type: 'Sell' as const, date: '2026-02-03', shares: 10, price: 120, amount: 1200, importedAt: '' }
    render(<SaleHarness transactions={[transaction]} />); openSale()
    fireEvent.change(screen.getByLabelText('Sale date'), { target: { value: transaction.date } })
    fireEvent.click(screen.getByRole('button', { name: 'Close position' }))
    expect(saleState().transactions).toEqual([transaction])
    expect(saleState().closedPositions[0].sellTransactionId).toBe('imported-sell')
  })
  it('Delete without a sale preserves unknown basis and creates no Sell', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SaleHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete this position' }))
    expect(saleState().closedPositions[0]).toMatchObject({ realizedGL: null, realizedGLBasis: 'unknown' })
    expect(saleState().transactions).toEqual([])
  })
})
