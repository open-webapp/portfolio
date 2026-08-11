import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AccountsPage } from './AccountsPage'
import { initialState, type AppState } from '../lib/state'

afterEach(cleanup)

/**
 * Helper to build an AppState with accounts in each tax category
 * and corresponding positions to populate cash/investment values.
 */
function buildAppStateWithAccounts(options?: {
  taxableAccounts?: number
  nonTaxableAccounts?: number
  taxDeferredAccounts?: number
}): AppState {
  const { taxableAccounts = 2, nonTaxableAccounts = 1, taxDeferredAccounts = 1 } = options || {}
  const state = initialState()

  let accountIdCounter = 1
  let positionIdCounter = 1

  // Helper to add account(s) of a given category with positions
  function addAccountsInCategory(
    taxCategory: 'taxable' | 'nonTaxable' | 'taxDeferred',
    count: number
  ) {
    for (let i = 0; i < count; i++) {
      const accId = `acc-${accountIdCounter++}`
      const name = taxCategory === 'taxable' ? 'Brokerage' : taxCategory === 'nonTaxable' ? 'HSA' : 'IRA'
      const accNumber = `${1000 + (accountIdCounter - 2)}`
      const institution = taxCategory === 'taxable' ? 'Fidelity' : taxCategory === 'nonTaxable' ? 'Anthem' : 'Vanguard'

      // Add account
      state.accounts.push({
        id: accId,
        accountNumber: accNumber,
        name: `${name} Account ${i + 1}`,
        institution,
        taxCategory,
        retirement: taxCategory === 'taxDeferred',
        createdAt: '2024-01-01',
      })

      // Add some positions (cash and investment)
      const cashPosId = `pos-${positionIdCounter++}`
      state.positions.push({
        id: cashPosId,
        accountId: accId,
        symbol: 'CASH',
        name: null,
        assetClass: 'Cash',
        shares: 10000 + i * 1000,
        avgCost: 1,
        price: 1,
        lastImportedAt: '2024-01-15',
      })

      const investPosId = `pos-${positionIdCounter++}`
      state.positions.push({
        id: investPosId,
        accountId: accId,
        symbol: 'AAPL',
        name: 'Apple',
        assetClass: 'Equities',
        shares: 100 + i * 10,
        avgCost: 150,
        price: 180,
        lastImportedAt: '2024-01-15',
      })
    }
  }

  addAccountsInCategory('taxable', taxableAccounts)
  addAccountsInCategory('nonTaxable', nonTaxableAccounts)
  addAccountsInCategory('taxDeferred', taxDeferredAccounts)

  return state
}

describe('AccountsPage', () => {
  describe('Test 1: Renders 3 section cards with correct labels in order', () => {
    it('renders Taxable, Non-Taxable, Tax-Deferred sections in that order', () => {
      const state = buildAppStateWithAccounts({
        taxableAccounts: 1,
        nonTaxableAccounts: 1,
        taxDeferredAccounts: 1,
      })
      render(<AccountsPage state={state} />)

      // Get all card-title elements
      const titles = Array.from(screen.getAllByText(/^(Taxable|Non-Taxable|Tax-Deferred)$/))
      expect(titles).toHaveLength(3)

      // Verify order: Taxable, Non-Taxable, Tax-Deferred
      expect(titles[0].textContent).toBe('Taxable')
      expect(titles[1].textContent).toBe('Non-Taxable')
      expect(titles[2].textContent).toBe('Tax-Deferred')
    })
  })

  describe('Test 2: Table headers are correct', () => {
    it('a category with accounts renders a .table with 5 expected column headers', () => {
      const state = buildAppStateWithAccounts({
        taxableAccounts: 1,
        nonTaxableAccounts: 0,
        taxDeferredAccounts: 0,
      })
      render(<AccountsPage state={state} />)

      const table = screen.getByRole('table')
      expect(table).toBeTruthy()
      expect(table.classList.contains('table')).toBe(true)

      // Check for all 5 headers
      expect(screen.getByText('Financial Institution')).toBeTruthy()
      expect(screen.getByText('Account')).toBeTruthy()
      expect(screen.getByText('Cash')).toBeTruthy()
      expect(screen.getByText('Investment')).toBeTruthy()
      expect(screen.getByText('Total')).toBeTruthy()
    })
  })

  describe('Test 3: Table rows render with correct content', () => {
    it('renders one <tr> per account with correct institution/account-name/cash/investment/total', () => {
      const state = buildAppStateWithAccounts({
        taxableAccounts: 2,
        nonTaxableAccounts: 0,
        taxDeferredAccounts: 0,
      })
      render(<AccountsPage state={state} />)

      // We should have 2 accounts in Taxable, so 2 tbody rows (plus 1 tfoot row)
      const table = screen.getByRole('table')
      const tbody = table.querySelector('tbody')
      expect(tbody).toBeTruthy()

      const bodyRows = tbody!.querySelectorAll('tr')
      expect(bodyRows).toHaveLength(2)

      // Check first account row
      const row1 = bodyRows[0]
      const cells1 = Array.from(row1.querySelectorAll('td')).map((td) => td.textContent?.trim())
      expect(cells1[0]).toBe('Fidelity') // institution
      expect(cells1[1]).toContain('Brokerage Account 1 (1000)') // account name with number
      expect(cells1[2]).toContain('$10,000') // cash: 10000 * 1
      expect(cells1[3]).toContain('$18,000') // investment: 100 * 180
      expect(cells1[4]).toContain('$28,000') // total

      // Check second account row
      const row2 = bodyRows[1]
      const cells2 = Array.from(row2.querySelectorAll('td')).map((td) => td.textContent?.trim())
      expect(cells2[0]).toBe('Fidelity')
      expect(cells2[1]).toContain('Brokerage Account 2 (1001)')
      expect(cells2[2]).toContain('$11,000') // 10000 + 1000
      expect(cells2[3]).toContain('$19,800') // (100 + 10) * 180
      expect(cells2[4]).toContain('$30,800') // total
    })
  })

  describe('Test 4: Subtotal row shows correct summed totals', () => {
    it('tfoot row shows correct summed totals for the section', () => {
      const state = buildAppStateWithAccounts({
        taxableAccounts: 2,
        nonTaxableAccounts: 0,
        taxDeferredAccounts: 0,
      })
      render(<AccountsPage state={state} />)

      const table = screen.getByRole('table')
      const tfoot = table.querySelector('tfoot')
      expect(tfoot).toBeTruthy()

      const tfootRow = tfoot!.querySelector('tr')
      expect(tfootRow).toBeTruthy()

      // Verify "Subtotal" label
      expect(screen.getByText('Subtotal')).toBeTruthy()

      // Get the td elements in tfoot
      const footerCells = Array.from(tfootRow!.querySelectorAll('td')).map((td) => td.textContent?.trim())

      // Expected sums:
      // Cash: 10000 + 11000 = 21000
      // Investment: 18000 + 19800 = 37800
      // Total: 21000 + 37800 = 58800
      expect(footerCells[1]).toContain('$21,000') // cash subtotal
      expect(footerCells[2]).toContain('$37,800') // investment subtotal
      expect(footerCells[3]).toContain('$58,800') // grand total
    })
  })

  describe('Test 5: Empty categories render "No accounts" message', () => {
    it('a category with zero accounts renders "No accounts in this category." instead of a table', () => {
      const state = buildAppStateWithAccounts({
        taxableAccounts: 1,
        nonTaxableAccounts: 0,
        taxDeferredAccounts: 0,
      })
      render(<AccountsPage state={state} />)

      // Taxable should have a table, Non-Taxable and Tax-Deferred should not
      const tables = screen.getAllByRole('table')
      expect(tables).toHaveLength(1) // Only Taxable has accounts

      // Check that the "No accounts" message appears for empty categories
      const noAccountsMessages = screen.getAllByText('No accounts in this category.')
      expect(noAccountsMessages.length).toBeGreaterThanOrEqual(2) // Non-Taxable and Tax-Deferred
    })
  })

  describe('Test 6: No interactive elements (read-only enforcement)', () => {
    it('no buttons/inputs render anywhere on the page', () => {
      const state = buildAppStateWithAccounts()
      render(<AccountsPage state={state} />)

      // Check for buttons
      const buttons = screen.queryAllByRole('button')
      expect(buttons).toHaveLength(0)

      // Check for inputs
      const inputs = screen.queryAllByRole('textbox')
      expect(inputs).toHaveLength(0)

      // Check for checkboxes
      const checkboxes = screen.queryAllByRole('checkbox')
      expect(checkboxes).toHaveLength(0)

      // Check for any form elements
      const form = document.querySelector('form')
      expect(form).toBeFalsy()
    })
  })

  describe('Test 7: Dividers render between sections 1-2 and 2-3, not after section 3', () => {
    it('dividers appear between Taxable-NonTaxable and NonTaxable-TaxDeferred, but not after TaxDeferred', () => {
      const state = buildAppStateWithAccounts()
      render(<AccountsPage state={state} />)

      // Get all divider elements (the styled div with border-bottom)
      // Based on the markup, dividers are divs with a borderBottom style
      const container = document.querySelector('[style*="padding"]')
      expect(container).toBeTruthy()

      const children = Array.from(container!.children)

      // Count divider elements (they have borderBottom style)
      let dividerCount = 0
      children.forEach((child) => {
        const style = (child as HTMLElement).getAttribute('style') || ''
        if (style.includes('border-bottom')) {
          dividerCount++
        }
      })

      // We expect exactly 2 dividers: one after Taxable card, one after Non-Taxable card
      expect(dividerCount).toBe(2)
    })
  })

  describe('Additional: All sections render correctly together', () => {
    it('renders complete page with all sections, tables, and dividers', () => {
      const state = buildAppStateWithAccounts({
        taxableAccounts: 1,
        nonTaxableAccounts: 1,
        taxDeferredAccounts: 1,
      })
      render(<AccountsPage state={state} />)

      // Verify all 3 sections exist
      expect(screen.getByText('Taxable')).toBeTruthy()
      expect(screen.getByText('Non-Taxable')).toBeTruthy()
      expect(screen.getByText('Tax-Deferred')).toBeTruthy()

      // Verify all have tables (since all have accounts)
      const tables = screen.getAllByRole('table')
      expect(tables).toHaveLength(3)

      // Verify all have subtotals
      const subtotalLabels = screen.getAllByText('Subtotal')
      expect(subtotalLabels).toHaveLength(3)
    })
  })
})
