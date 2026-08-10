export type TaxCategory = 'taxable' | 'nonTaxable' | 'taxDeferred'

export type AssetClass =
  | 'Equity' | 'ETF' | 'Mutual Fund' | 'Fixed Income' | 'Crypto' | 'Cash' | 'Other'

export interface Account {
  id: string
  accountNumber: string
  name: string
  institution: string
  taxCategory: TaxCategory
  retirement: boolean
  createdAt: string
}

export interface SavedCsvMapping {
  id: string              // uid('mapping')
  accountId: string
  kind: 'positions' | 'transactions'
  fieldMap: Record<string, string>  // csvColumn -> targetField, same shape as ImportDialog's fieldMap state
  updatedAt: string       // ISO
}

export interface Position {
  id: string
  accountId: string
  symbol: string
  name: string | null
  assetClass: string
  assetClassManualOverride?: string
  shares: number
  avgCost: number
  price: number
  taxes: number | null
  lastImportedAt: string
}

export interface ClosedPosition {
  id: string
  accountId: string
  symbol: string
  name: string | null
  closedDate: string
  assetClass: string
  realizedGL: number | null
  realizedGLBasis: 'transactions' | 'unknown'
}

export interface Transaction {
  id: string
  accountId: string
  date: string
  symbol: string
  type: string
  shares: number
  price: number
  amount: number
  taxes: number | null
  importedAt: string
}

export interface PortfolioSnapshot {
  id: string
  accountId: string
  date: string
  value: number
}

export const POSITIONS_REQUIRED_FIELDS = [
  'symbol',
  'assetClass',
  'shares',
  'avgCost',
  'purchaseAmount',  // alternative to avgCost
  'price',
  'marketValue',     // alternative to price
] as const

export const AVGCOST_FIELDS = ['avgCost', 'purchaseAmount'] as const
export const PRICE_FIELDS = ['price', 'marketValue'] as const
export const POSITIONS_OPTIONAL_FIELDS = ['name', 'taxes'] as const

export const TRANSACTIONS_REQUIRED_FIELDS = ['date', 'symbol', 'type', 'shares', 'price', 'amount'] as const
export const TRANSACTIONS_OPTIONAL_FIELDS = ['taxes'] as const
