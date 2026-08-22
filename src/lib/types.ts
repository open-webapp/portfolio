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
  lastImportedAt: string
}

export interface ClosedPosition {
  id: string
  accountId: string
  symbol: string
  name: string | null
  closedDate: string
  assetClass: string
  shares: number
  avgCost: number
  price: number
  assetClassManualOverride?: string
  lastImportedAt: string
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
export const POSITIONS_OPTIONAL_FIELDS = ['name'] as const

export const TRANSACTIONS_REQUIRED_FIELDS = ['date', 'symbol', 'type', 'shares', 'price', 'amount'] as const
export const TRANSACTIONS_OPTIONAL_FIELDS = [] as const

export interface HeldSymbolPrice {
  price: number
  date: string       // YYYY-MM-DD, the trading date this price is for
  fetchedAt: string  // ISO timestamp of when the fetch happened
}

export interface PriceSyncLastRun {
  at: string           // ISO timestamp
  updatedCount: number
  notFound: string[]   // held Equity/ETF symbols absent from the last response
}

export interface PriceSyncState {
  apiKey: string
  lastFetchedDate: string | null  // YYYY-MM-DD of last successful non-empty fetch
  heldPrices: Record<string, HeldSymbolPrice>  // symbol -> latest price
  lastRun: PriceSyncLastRun | null
}
