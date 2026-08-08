import Papa from 'papaparse'

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
}

/**
 * Parse a CSV cell as a number, tolerating brokerage-style currency formatting
 * (leading '$', thousands commas, surrounding whitespace) that plain parseFloat
 * either rejects outright ("$3.79" -> NaN) or silently mis-parses ("1,234" -> 1).
 */
export function parseCsvNumber(value: string | undefined | null): number {
  if (!value) return NaN
  const cleaned = value.replace(/[$,\s]/g, '')
  return parseFloat(cleaned)
}

/**
 * Parse a CSV file and return its headers and rows.
 * Uses Papa.parse with header:true and skipEmptyLines:true.
 * Returns raw string values with no type coercion or mapping logic.
 *
 * @param file - The File object to parse
 * @returns Promise resolving to {headers, rows} with raw string data
 * @throws Error if CSV parsing fails or file reading fails
 */
export async function parseCsvFile(file: File): Promise<ParsedCsv> {
  // Read file as text
  const text = await file.text()

  // Parse CSV with headers enabled and empty lines skipped
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false, // Keep all values as strings
  })

  // Extract rows from parsed data
  const rawRows = (parsed.data || []) as Record<string, string>[]

  // Determine headers from meta.fields (includes headers even if no data rows)
  // Fall back to first row keys if meta.fields unavailable
  const headers =
    (parsed.meta && parsed.meta.fields) ||
    (rawRows.length > 0 ? Object.keys(rawRows[0]) : [])

  // Filter out __parsed_extra field (created by Papa.parse for extra columns)
  const rows = rawRows.map((row) => {
    const cleanRow: Record<string, string> = {}
    for (const header of headers) {
      if (header in row) {
        cleanRow[header] = row[header]
      }
    }
    return cleanRow
  })

  return {
    headers: headers as string[],
    rows,
  }
}
