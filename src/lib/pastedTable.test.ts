import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { tableToCsv } from './pastedTable'
import type { PastedClipboard, CsvIssue, TableToCsvResult } from './pastedTable'

/**
 * Shared test cases for both the TS implementation (pastedTable.ts) and the
 * hand-mirrored classic-script JS implementation (root-level pastedTable.js,
 * exposed as window.PastedTable.tableToCsv). Later tasks append more entries
 * here rather than writing new describe blocks.
 *
 * `expect*` fields are all optional — only the ones provided on a given case
 * are asserted. `expectIssues`, when provided, is compared with `toEqual`
 * against the full `issues` array (order-sensitive).
 */
interface TableToCsvCase {
  name: string
  headers: PastedClipboard
  values: PastedClipboard
  expect: {
    expectHeaders?: string[]
    expectRows?: Record<string, string>[]
    expectCsv?: string
    expectIssues?: CsvIssue[]
  }
}

export const CASES: TableToCsvCase[] = [
  {
    name: 'trivial tab-separated headers + single data row',
    headers: { text: 'a\tb' },
    values: { text: '1\t2' },
    expect: {
      expectHeaders: ['a', 'b'],
      expectRows: [{ a: '1', b: '2' }],
    },
  },
  {
    name: 'headers pasted vertically (one per line) flatten to a single ordered list',
    headers: { text: 'Sym\nQty\nPrice' },
    values: { text: '' },
    expect: {
      expectHeaders: ['Sym', 'Qty', 'Price'],
    },
  },
  {
    name: 'headers pasted as one tab-delimited line',
    headers: { text: 'Sym\tQty\tPrice' },
    values: { text: '' },
    expect: {
      expectHeaders: ['Sym', 'Qty', 'Price'],
    },
  },
  {
    name: 'HTML header table spanning multiple <tr> rows flattens to one ordered list',
    headers: {
      html: '<table><tr><th>Sym</th><th>Qty</th></tr><tr><th>Price</th></tr></table>',
    },
    values: { text: '' },
    expect: {
      expectHeaders: ['Sym', 'Qty', 'Price'],
    },
  },
  {
    // Blank cells are filtered out of `survivors` before the column_N
    // fallback ever runs (parseHeaders: `rawCells.filter((cell) =>
    // cell.length > 0)`), so a "survivor" can never still be blank by the
    // time the column_${i+1} fallback check runs — that branch is
    // defensive/unreachable given blanks are pre-filtered. This case pins
    // that blanks are dropped entirely, not replaced with a placeholder.
    name: 'blank header cell between two real headers is dropped, not replaced with column_N',
    headers: {
      html: '<table><tr><th>Sym</th><th></th><th>Price</th></tr></table>',
    },
    values: { text: '' },
    expect: {
      expectHeaders: ['Sym', 'Price'],
    },
  },
  {
    name: 'duplicate header names are uniquified with _2, _3 suffixes',
    headers: { text: 'Qty\tQty\tQty' },
    values: { text: '' },
    expect: {
      expectHeaders: ['Qty', 'Qty_2', 'Qty_3'],
    },
  },
  {
    name: 'uniquify skips a suffix that collides with a literal existing header',
    headers: { text: 'a\ta_2\ta' },
    values: { text: '' },
    expect: {
      expectHeaders: ['a', 'a_2', 'a_3'],
    },
  },
  {
    name: 'nbsp inside a header cell is normalized to a plain space',
    headers: { text: 'Sym Name\tPrice' },
    values: { text: '' },
    expect: {
      expectHeaders: ['Sym Name', 'Price'],
    },
  },
  {
    name: 'empty headers clipboard object produces empty everything (N=0 short-circuit)',
    headers: {},
    values: { text: '' },
    expect: {
      expectHeaders: [],
      expectRows: [],
      expectCsv: '',
      expectIssues: [],
    },
  },
  {
    name: 'headers clipboard with empty text produces empty everything (N=0 short-circuit)',
    headers: { text: '' },
    values: { text: '' },
    expect: {
      expectHeaders: [],
      expectRows: [],
      expectCsv: '',
      expectIssues: [],
    },
  },
  {
    name: 'headers clipboard with only whitespace produces empty everything (N=0 short-circuit)',
    headers: { text: '   \n\t ' },
    values: { text: '' },
    expect: {
      expectHeaders: [],
      expectRows: [],
      expectCsv: '',
      expectIssues: [],
    },
  },
  {
    name: 'tab-delimited values row with an embedded empty cell does not shift columns',
    headers: { text: 'a\tb\tc' },
    values: { text: 'AAPL\t\t10' },
    expect: {
      expectRows: [{ a: 'AAPL', b: '', c: '10' }],
      expectIssues: [],
    },
  },
  {
    name: 'flat one-per-line value list is chunked n-at-a-time into rows',
    headers: { text: 'a\tb\tc' },
    values: { text: 'v1\nv2\nv3\nv4\nv5\nv6' },
    expect: {
      expectRows: [
        { a: 'v1', b: 'v2', c: 'v3' },
        { a: 'v4', b: 'v5', c: 'v6' },
      ],
      expectIssues: [],
    },
  },
  {
    name: 'buffered bare lines flush as their own row before a tab-delimited row is emitted, preserving document order',
    headers: { text: 'a\tb\tc' },
    values: { text: 'solo1\na\tb\tc\nsolo2\nsolo3' },
    expect: {
      expectRows: [
        { a: 'solo1', b: '', c: '' },
        { a: 'a', b: 'b', c: 'c' },
        { a: 'solo2', b: 'solo3', c: '' },
      ],
      expectIssues: [
        { rowIndex: 0, got: 1, expected: 3 },
        { rowIndex: 2, got: 2, expected: 3 },
      ],
    },
  },
  {
    name: 'flat one-per-line values with a consistent trailing extra cell per row (e.g. a screen-reader-only "View details" link) are chunked at the wider width and the extra cell dropped, without shifting later rows',
    headers: {
      text: 'Ticker\nFund info\nClass\nShares\nPrice\nPercent\nYTD RoR\nBalance',
    },
    values: {
      text:
        'VTMNX\nVANGUARD DEVELOPED MKTS IDX I\nINTERNATIONAL LGE BLEND\n226.724\n$23.31\n21.23%\n$634.95 (16.27%)\n$5,284.94\nView details for VANGUARD DEVELOPED MKTS IDX I\n' +
        'VEMIX\nVANGUARD EMRG MKTS STK IDX INS\nEMERGING MARKETS--INTERNATIONAL\n51.998\n$38.10\n7.96%\n$188.63 (12.04%)\n$1,981.12\nView details for VANGUARD EMRG MKTS STK IDX INS',
    },
    expect: {
      expectRows: [
        {
          Ticker: 'VTMNX',
          'Fund info': 'VANGUARD DEVELOPED MKTS IDX I',
          Class: 'INTERNATIONAL LGE BLEND',
          Shares: '226.724',
          Price: '$23.31',
          Percent: '21.23%',
          'YTD RoR': '$634.95 (16.27%)',
          Balance: '$5,284.94',
        },
        {
          Ticker: 'VEMIX',
          'Fund info': 'VANGUARD EMRG MKTS STK IDX INS',
          Class: 'EMERGING MARKETS--INTERNATIONAL',
          Shares: '51.998',
          Price: '$38.10',
          Percent: '7.96%',
          'YTD RoR': '$188.63 (12.04%)',
          Balance: '$1,981.12',
        },
      ],
      expectIssues: [],
    },
  },
  {
    name: 'the "View details for X" accessibility-link line is dropped even when it only appears on SOME rows (inconsistent per-row width defeats a pure divisibility heuristic)',
    headers: {
      text: 'Ticker\nFund info\nClass\nShares\nPrice\nPercent\nYTD RoR\nBalance',
    },
    values: {
      text:
        'VTMNX\nVANGUARD DEVELOPED MKTS IDX I\nINTERNATIONAL LGE BLEND\n226.724\n$23.31\n21.23%\n$634.95 (16.27%)\n$5,284.94\nView details for VANGUARD DEVELOPED MKTS IDX I\n' +
        'VEMIX\nVANGUARD EMRG MKTS STK IDX INS\nEMERGING MARKETS--INTERNATIONAL\n51.998\n$38.10\n7.96%\n$188.63 (12.04%)\n$1,981.12',
    },
    expect: {
      expectRows: [
        {
          Ticker: 'VTMNX',
          'Fund info': 'VANGUARD DEVELOPED MKTS IDX I',
          Class: 'INTERNATIONAL LGE BLEND',
          Shares: '226.724',
          Price: '$23.31',
          Percent: '21.23%',
          'YTD RoR': '$634.95 (16.27%)',
          Balance: '$5,284.94',
        },
        {
          Ticker: 'VEMIX',
          'Fund info': 'VANGUARD EMRG MKTS STK IDX INS',
          Class: 'EMERGING MARKETS--INTERNATIONAL',
          Shares: '51.998',
          Price: '$38.10',
          Percent: '7.96%',
          'YTD RoR': '$188.63 (12.04%)',
          Balance: '$1,981.12',
        },
      ],
      expectIssues: [],
    },
  },
  {
    name: 'HTML colspan=2 spills a blank sibling cell rather than shifting later columns',
    headers: { text: 'col1\tcol2\tcol3' },
    values: {
      html: '<table><tr><td colspan="2">X</td><td>Y</td></tr></table>',
    },
    expect: {
      expectRows: [{ col1: 'X', col2: '', col3: 'Y' }],
      expectIssues: [],
    },
  },
  {
    name: 'HTML rowspan=3 carries the spanned cell text down into every covered row',
    headers: { text: 'col1\tcol2\tcol3' },
    values: {
      html:
        '<table><tr><td rowspan="3">X</td><td>r0b</td><td>r0c</td></tr>' +
        '<tr><td>r1b</td><td>r1c</td></tr>' +
        '<tr><td>r2b</td><td>r2c</td></tr></table>',
    },
    expect: {
      expectRows: [
        { col1: 'X', col2: 'r0b', col3: 'r0c' },
        { col1: 'X', col2: 'r1b', col3: 'r1c' },
        { col1: 'X', col2: 'r2b', col3: 'r2c' },
      ],
      expectIssues: [],
    },
  },
  {
    name: 'HTML colspan and rowspan interacting on the same grid expand correctly together',
    headers: { text: 'col1\tcol2\tcol3' },
    values: {
      html:
        '<table><tr><td rowspan="2">A</td><td colspan="2">B</td></tr>' +
        '<tr><td>C</td><td>D</td></tr></table>',
    },
    expect: {
      expectRows: [
        { col1: 'A', col2: 'B', col3: '' },
        { col1: 'A', col2: 'C', col3: 'D' },
      ],
      expectIssues: [],
    },
  },
  {
    name: 'a value cell containing a comma is quoted in CSV but left raw in rows',
    headers: { text: 'c1\tc2\tc3' },
    values: { text: 'a,b\tfoo\tbar' },
    expect: {
      expectRows: [{ c1: 'a,b', c2: 'foo', c3: 'bar' }],
      expectCsv: 'c1,c2,c3\r\n"a,b",foo,bar',
      expectIssues: [],
    },
  },
  {
    name: 'a value cell containing a double quote is doubled and wrapped in CSV',
    headers: { text: 'c1\tc2\tc3' },
    values: { text: 'a"b\tfoo\tbar' },
    expect: {
      expectRows: [{ c1: 'a"b', c2: 'foo', c3: 'bar' }],
      expectCsv: 'c1,c2,c3\r\n"a""b",foo,bar',
      expectIssues: [],
    },
  },
  {
    name: 'a <br> inside an HTML value cell normalizes to a single space, not a jammed word',
    headers: { text: 'c1\tc2\tc3' },
    values: {
      html:
        '<table><tr><td>Line one<br>Line two</td><td>X</td><td>Y</td></tr></table>',
    },
    expect: {
      expectRows: [{ c1: 'Line one Line two', c2: 'X', c3: 'Y' }],
      expectCsv: 'c1,c2,c3\r\nLine one Line two,X,Y',
      expectIssues: [],
    },
  },
  {
    name: 'literal newlines and indentation inside pretty-printed HTML markup collapse to single spaces',
    headers: { text: 'c1\tc2\tc3' },
    values: {
      html: '<table><tr><td>\n  Foo\n  Bar\n</td><td>X</td><td>Y</td></tr></table>',
    },
    expect: {
      expectRows: [{ c1: 'Foo Bar', c2: 'X', c3: 'Y' }],
      expectIssues: [],
    },
  },
  {
    name: 'a values row wider than the header count is truncated and recorded as an issue',
    headers: { text: 'c1\tc2\tc3' },
    values: { text: '1\t2\t3\t4' },
    expect: {
      expectRows: [{ c1: '1', c2: '2', c3: '3' }],
      expectIssues: [{ rowIndex: 0, got: 4, expected: 3 }],
    },
  },
  {
    name: 'a values row narrower than the header count is padded and recorded as an issue',
    headers: { text: 'c1\tc2\tc3' },
    values: { text: '1\t2' },
    expect: {
      expectRows: [{ c1: '1', c2: '2', c3: '' }],
      expectIssues: [{ rowIndex: 0, got: 2, expected: 3 }],
    },
  },
  {
    name: 'clean, non-ragged input reports an empty issues array (not undefined)',
    headers: { text: 'a\tb\tc' },
    values: { text: '1\t2\t3' },
    expect: {
      expectRows: [{ a: '1', b: '2', c: '3' }],
      expectIssues: [],
    },
  },
  {
    name: 'nbsp inside a value cell is normalized to a plain space',
    headers: { text: 'c1\tc2' },
    values: { text: 'Foo Bar\tX' },
    expect: {
      expectRows: [{ c1: 'Foo Bar', c2: 'X' }],
      expectIssues: [],
    },
  },
  {
    name: 'empty values paste against non-empty headers yields no rows and a header-only CSV with no trailing newline',
    headers: { text: 'a\tb\tc' },
    values: {},
    expect: {
      expectRows: [],
      expectCsv: 'a,b,c',
      expectIssues: [],
    },
  },
  {
    name: 'full CSV string on a rich multi-row fixture uses \\r\\n separators, no trailing newline, header first',
    headers: { text: 'Name\tQty\tNote' },
    values: {
      text: 'Alice\t10\tHello, world\nBob\t20\tPlain\nCarl\t30\tSay "hi"',
    },
    expect: {
      expectRows: [
        { Name: 'Alice', Qty: '10', Note: 'Hello, world' },
        { Name: 'Bob', Qty: '20', Note: 'Plain' },
        { Name: 'Carl', Qty: '30', Note: 'Say "hi"' },
      ],
      expectCsv:
        'Name,Qty,Note\r\nAlice,10,"Hello, world"\r\nBob,20,Plain\r\nCarl,30,"Say ""hi"""',
      expectIssues: [],
    },
  },
]

type TableToCsvFn = (
  headers: PastedClipboard,
  values: PastedClipboard,
) => TableToCsvResult

const tsImpl: TableToCsvFn = tableToCsv

let jsImpl: TableToCsvFn | undefined

beforeAll(() => {
  try {
    const jsPath = path.resolve(__dirname, '../../pastedTable.js')
    const src = fs.readFileSync(jsPath, 'utf-8')
    // eslint-disable-next-line no-new-func
    new Function(src).call(globalThis)
    const candidate = (globalThis as any).window?.PastedTable?.tableToCsv
    if (typeof candidate === 'function') {
      jsImpl = candidate
    }
  } catch {
    // pastedTable.js doesn't exist yet (created in a later task) — leave
    // jsImpl undefined so dependent tests fail loudly and specifically
    // instead of blowing up collection for the whole file.
  }
})

function runImpl(
  impl: TableToCsvFn | undefined,
  headers: PastedClipboard,
  values: PastedClipboard,
): TableToCsvResult {
  if (typeof impl !== 'function') {
    throw new Error('implementation under test is not available (function missing)')
  }
  return impl(headers, values)
}

describe.each([
  ['ts', () => tsImpl],
  ['js', () => jsImpl],
] as const)('tableToCsv (%s)', (_label, getImpl) => {
  for (const c of CASES) {
    it(c.name, () => {
      const result = runImpl(getImpl(), c.headers, c.values)

      if (c.expect.expectHeaders !== undefined) {
        expect(result.headers).toEqual(c.expect.expectHeaders)
      }
      if (c.expect.expectRows !== undefined) {
        expect(result.rows).toEqual(c.expect.expectRows)
      }
      if (c.expect.expectCsv !== undefined) {
        expect(result.csv).toEqual(c.expect.expectCsv)
      }
      if (c.expect.expectIssues !== undefined) {
        expect(result.issues).toEqual(c.expect.expectIssues)
      }
    })
  }
})

describe('pastedTable.js global', () => {
  it('exposes window.PastedTable.tableToCsv as a function', () => {
    expect(typeof jsImpl).toBe('function')
  })
})
