import type { ParsedCsv } from './csv'

export interface PastedClipboard {
  html?: string
  text?: string
}

export interface CsvIssue {
  rowIndex: number
  got: number
  expected: number
}

export interface TableToCsvResult {
  headers: string[]
  rows: Record<string, string>[]
  csv: string
  issues: CsvIssue[]
}

// Drift pin: if TableToCsvResult ever stops being a structural superset of
// ParsedCsv, this assignment becomes `never` and tsc -b fails the build.
export type PastedTableIsParsedCsv = TableToCsvResult extends ParsedCsv ? true : never

/**
 * Normalize a raw cell string: convert non-breaking spaces to plain spaces,
 * collapse runs of whitespace to a single space, and trim the ends.
 */
function normalizeCell(s: string): string {
  return s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Decide which branch of the clipboard payload to parse: prefer HTML if it
 * contains a <table>, otherwise fall back to plain text if present and
 * non-blank, otherwise there's nothing usable.
 */
function pickBranch(clip: PastedClipboard): 'html' | 'text' | 'none' {
  if (clip.html && /<table/i.test(clip.html)) return 'html'
  if (clip.text && clip.text.trim().length > 0) return 'text'
  return 'none'
}

/**
 * Flatten header cells across row/line boundaries (row/line structure is
 * ignored entirely), drop blank cells, and uniquify the survivors in order.
 */
function parseHeaders(clip: PastedClipboard): string[] {
  const branch = pickBranch(clip)

  let rawCells: string[]
  if (branch === 'html') {
    const doc = new DOMParser().parseFromString(clip.html!, 'text/html')
    rawCells = Array.from(doc.querySelectorAll('th, td')).map(
      (el) => normalizeCell(el.textContent ?? ''),
    )
  } else if (branch === 'text') {
    rawCells = clip.text!.split(/[\t\r\n]/).map((piece) => normalizeCell(piece))
  } else {
    return []
  }

  const survivors = rawCells.filter((cell) => cell.length > 0)

  const seen = new Set<string>()
  const result: string[] = []
  for (let i = 0; i < survivors.length; i++) {
    let candidate = survivors[i]
    if (!candidate) {
      candidate = `column_${i + 1}`
    }
    if (seen.has(candidate)) {
      let suffix = 2
      let attempt = `${candidate}_${suffix}`
      while (seen.has(attempt)) {
        suffix++
        attempt = `${candidate}_${suffix}`
      }
      candidate = attempt
    }
    seen.add(candidate)
    result.push(candidate)
  }

  return result
}

/**
 * Extract normalized text from an HTML cell: <br> tags and block-element
 * boundaries become a space (so `Line one<br>Line two` doesn't jam into
 * `Line oneLine two`), then the result is run through normalizeCell to
 * collapse whitespace and trim.
 */
function cellText(cell: Element): string {
  const html = cell.innerHTML.replace(/<br\s*\/?>/gi, ' ')
  const doc = new DOMParser().parseFromString(
    `<div>${html}</div>`,
    'text/html',
  )
  const container = doc.body.firstElementChild
  return normalizeCell(container?.textContent ?? '')
}

/**
 * Parse the first <table> in an HTML fragment into a fixed rectangular
 * grid, expanding colspan/rowspan so every cell's text lands in every
 * grid slot it visually covers. Colspan spill slots (same row) are blank;
 * rowspan carry slots (rows below) repeat the cell's text.
 */
function parseHtmlGrid(html: string): string[][] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (!table) return []

  const clamp = (n: number): number => Math.max(1, Math.min(1000, n))

  const grid: string[][] = []
  const rows = Array.from(table.querySelectorAll('tr'))

  for (let r = 0; r < rows.length; r++) {
    const tr = rows[r]
    if (!grid[r]) grid[r] = []
    const cells = Array.from(tr.children).filter(
      (el): el is HTMLTableCellElement =>
        el.tagName === 'TD' || el.tagName === 'TH',
    )

    for (const cell of cells) {
      // Find lowest still-free column index in this row.
      let c = 0
      while (grid[r][c] !== undefined) c++

      const cs = clamp(cell.colSpan || 1)
      const rs = clamp(cell.rowSpan || 1)
      const text = cellText(cell)

      grid[r][c] = text
      for (let k = 1; k < cs; k++) {
        grid[r][c + k] = ''
      }

      for (let dr = 1; dr < rs; dr++) {
        if (!grid[r + dr]) grid[r + dr] = []
        grid[r + dr][c] = text
        for (let k = 1; k < cs; k++) {
          grid[r + dr][c + k] = ''
        }
      }
    }
  }

  const numRows = grid.length
  let maxCols = 0
  for (const row of grid) {
    if (row.length > maxCols) maxCols = row.length
  }

  const result: string[][] = []
  for (let r = 0; r < numRows; r++) {
    const row: string[] = []
    for (let c = 0; c < maxCols; c++) {
      row[c] = grid[r]?.[c] ?? ''
    }
    result.push(row)
  }

  return result
}

/**
 * Screen-reader-only "View details for X" / "View more for X" link text
 * that some sites emit as its own line in a table row's plain-text copy.
 * It isn't a real column and doesn't reliably appear on every row (e.g. the
 * last row may lack it), so it's dropped outright rather than counted
 * toward row width — a fixed-width heuristic alone can't handle a line that
 * shows up on some rows but not others.
 */
const ACCESSIBILITY_LINK_LINE = /^(view (details|more) (for|about)\b)/i

/**
 * Detect the true per-row width of a buffered run of bare lines when it's
 * wider than the header count n — e.g. a screen-reader-only "View details
 * for X" link line copied after every row. If the buffer doesn't divide
 * evenly into n-sized rows, look for the smallest width > n (capped at n+8)
 * that DOES divide it evenly, so each row's trailing extra cell(s) can be
 * dropped instead of bleeding into the next row. Falls back to n when no
 * such width exists (ragged paste — same behavior as before).
 */
function findRowWidth(bufferLength: number, n: number): number {
  if (bufferLength === 0 || bufferLength % n === 0) return n
  const maxExtra = 8
  for (let extra = 1; extra <= maxExtra; extra++) {
    const w = n + extra
    if (w > bufferLength) break
    if (bufferLength % w === 0) return w
  }
  return n
}

/**
 * Parse the plain-text branch into rows on a per-line basis: lines
 * containing a tab are treated as already-delimited rows (empty cells
 * preserved), while consecutive non-tab lines are buffered and flushed in
 * document order, chunked at the detected row width (n, or a wider width if
 * that's the only way to divide the buffer evenly — see findRowWidth),
 * dropping any trailing extra cells beyond n, immediately before the next
 * tab-row (and at the end of input).
 */
function parseTextRows(text: string, n: number): string[][] {
  const lines = text.split(/\r\n|\r|\n/)
  const result: string[][] = []
  let buffer: string[] = []

  const flush = (): void => {
    if (buffer.length === 0) return
    const chunkSize = n > 0 ? findRowWidth(buffer.length, n) : 1
    for (let i = 0; i < buffer.length; i += chunkSize) {
      result.push(buffer.slice(i, i + chunkSize).slice(0, n))
    }
    buffer = []
  }

  for (const line of lines) {
    if (line.trim().length === 0) continue
    if (ACCESSIBILITY_LINK_LINE.test(line)) continue

    if (line.includes('\t')) {
      flush()
      result.push(line.split('\t').map((piece) => normalizeCell(piece)))
    } else {
      buffer.push(normalizeCell(line))
    }
  }

  flush()

  return result
}

/**
 * Pad or truncate every row to exactly length n, recording a CsvIssue for
 * any row whose original length didn't match.
 */
function fitRows(
  rawRows: string[][],
  n: number,
): { rows: string[][]; issues: CsvIssue[] } {
  const rows: string[][] = []
  const issues: CsvIssue[] = []

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i]
    const got = row.length

    if (got === n) {
      rows.push(row)
      continue
    }

    issues.push({ rowIndex: i, got, expected: n })

    if (got < n) {
      const padded = row.slice()
      while (padded.length < n) padded.push('')
      rows.push(padded)
    } else {
      rows.push(row.slice(0, n))
    }
  }

  return { rows, issues }
}

/**
 * RFC 4180 field serialization: quote the field only when it contains a
 * comma, double quote, CR, or LF, doubling any embedded double quotes.
 */
function csvField(s: string): string {
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * Build full CSV text from a header row and data rows, joining with \r\n
 * row terminators and no trailing terminator or BOM.
 */
function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(csvField).join(',')]
  for (const row of rows) {
    lines.push(row.map(csvField).join(','))
  }
  return lines.join('\r\n')
}

/**
 * Assemble a pasted headers clipboard and a pasted values clipboard into a
 * CSV result: parse headers, parse the values grid per the values
 * clipboard's branch, fit every row to the header count, and serialize.
 */
export function tableToCsv(
  headersClipboard: PastedClipboard,
  valuesClipboard: PastedClipboard,
): TableToCsvResult {
  const headers = parseHeaders(headersClipboard)
  const n = headers.length

  if (n === 0) {
    return { headers: [], rows: [], csv: '', issues: [] }
  }

  const branch = pickBranch(valuesClipboard)
  let rawGrid: string[][]
  if (branch === 'html') {
    rawGrid = parseHtmlGrid(valuesClipboard.html!)
  } else if (branch === 'text') {
    rawGrid = parseTextRows(valuesClipboard.text!, n)
  } else {
    rawGrid = []
  }

  const { rows: fittedGrid, issues } = fitRows(rawGrid, n)

  const rows: Record<string, string>[] = fittedGrid.map((row) => {
    const obj: Record<string, string> = {}
    for (let i = 0; i < n; i++) {
      obj[headers[i]] = row[i]
    }
    return obj
  })

  const csv = toCsv(headers, fittedGrid)

  return { headers, rows, csv, issues }
}
