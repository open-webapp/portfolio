export interface ExpensePasteRow {
  name: string
  amount: number
  lineNumber: number
}

export interface ExpensePasteError {
  lineNumber: number
  reason: string
}

export interface ExpensePasteParseResult {
  totalDataLines: number
  validRows: ExpensePasteRow[]
  errors: ExpensePasteError[]
}

const DECIMAL_AMOUNT = /^\d+(?:\.\d+)?$/
const THOUSANDS_AMOUNT = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/

export function parseExpensePaste(text: string): ExpensePasteParseResult {
  const validRows: ExpensePasteRow[] = []
  const errors: ExpensePasteError[] = []
  let totalDataLines = 0
  let headerSeen = false

  for (const [index, sourceLine] of text.split(/\r?\n/).entries()) {
    if (!sourceLine.trim()) continue
    if (!headerSeen) {
      headerSeen = true
      continue
    }

    const lineNumber = index + 1
    totalDataLines += 1
    const delimiter = sourceLine.includes('\t') ? '\t' : ','
    const fields = sourceLine.split(delimiter)

    if (fields.length !== 2) {
      errors.push({ lineNumber, reason: 'expected exactly two fields' })
      continue
    }

    const name = fields[0].trim()
    if (!name) {
      errors.push({ lineNumber, reason: 'name is required' })
      continue
    }

    const amountText = fields[1].trim().replace(/^\$/, '')
    const isValidAmount = delimiter === '\t'
      ? DECIMAL_AMOUNT.test(amountText) || THOUSANDS_AMOUNT.test(amountText)
      : DECIMAL_AMOUNT.test(amountText)

    if (!isValidAmount) {
      errors.push({ lineNumber, reason: 'amount must be a positive decimal number' })
      continue
    }

    const amount = Number(amountText.replaceAll(',', ''))
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push({ lineNumber, reason: 'amount must be greater than zero' })
      continue
    }

    validRows.push({ name, amount, lineNumber })
  }

  return { totalDataLines, validRows, errors }
}
