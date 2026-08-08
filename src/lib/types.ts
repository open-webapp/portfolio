export type TaxCategory = 'taxable' | 'nonTaxable' | 'taxDeferred'

export type AssetClass =
  | 'Equity' | 'ETF' | 'Mutual Fund' | 'Fixed Income' | 'Crypto' | 'Cash' | 'Other'

export interface Account {
  id: string
  accountNumber: string
  name: string
  taxCategory: TaxCategory
  retirement: boolean
  createdAt: string
}

export interface Position {
  id: string
  accountId: string
  symbol: string
  name: string
  assetClass: string
  assetClassManualOverride?: string
  shares: number
  avgCost: number
  price: number
  lastImportedAt: string
}

export interface ClosedPosition {
  id: string
  accountId: string
  symbol: string
  name: string
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
  importedAt: string
}

export interface PortfolioSnapshot {
  id: string
  accountId: string
  date: string
  value: number
}

export interface MappingProfile {
  id: string
  name: string
  kind: 'positions' | 'transactions'
  fieldMap: Record<string, string>
  accountNumberColumn?: string
  createdAt: string
  updatedAt: string
}

export const POSITIONS_REQUIRED_FIELDS = [
  'symbol',
  'name',
  'assetClass',
  'shares',
  'avgCost',
  'purchaseAmount',  // NEW: alternative to avgCost
  'price',
  'marketValue',     // NEW: alternative to price
] as const

export const AVGCOST_FIELDS = ['avgCost', 'purchaseAmount'] as const
export const PRICE_FIELDS = ['price', 'marketValue'] as const

export const TRANSACTIONS_REQUIRED_FIELDS = ['date', 'symbol', 'type', 'shares', 'price', 'amount'] as const
