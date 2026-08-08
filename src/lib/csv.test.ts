import { describe, it, expect } from 'vitest'
import { parseCsvFile } from './csv'

/**
 * Helper to create a File object from CSV string content
 */
function createCsvFile(content: string, filename: string = 'test.csv'): File {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  return new File([blob], filename, { type: 'text/csv' })
}

describe('parseCsvFile', () => {
  // Test 1: Parse a simple CSV with headers and 2 data rows
  it('parses a simple CSV with headers and 2 data rows', async () => {
    const csvContent = `Name,Age,City
John,30,New York
Jane,25,San Francisco`

    const file = createCsvFile(csvContent)
    const result = await parseCsvFile(file)

    expect(result.headers).toEqual(['Name', 'Age', 'City'])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual({ Name: 'John', Age: '30', City: 'New York' })
    expect(result.rows[1]).toEqual({ Name: 'Jane', Age: '25', City: 'San Francisco' })
  })

  // Test 2: Parse CSV with special characters and quotes
  it('parses CSV with special characters and quoted fields', async () => {
    const csvContent = `Product,Description,Price
"Widget, Premium","A high-quality widget with ""special"" features","$19.99"
"Gadget","Description with, comma and newline chars","$9.99"`

    const file = createCsvFile(csvContent)
    const result = await parseCsvFile(file)

    expect(result.headers).toEqual(['Product', 'Description', 'Price'])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].Product).toBe('Widget, Premium')
    expect(result.rows[0].Description).toContain('special')
    expect(result.rows[1].Price).toBe('$9.99')
  })

  // Test 3: Skip empty lines correctly
  it('skips empty lines in the CSV', async () => {
    const csvContent = `ID,Value

1,First

2,Second

3,Third

`

    const file = createCsvFile(csvContent)
    const result = await parseCsvFile(file)

    expect(result.headers).toEqual(['ID', 'Value'])
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0]).toEqual({ ID: '1', Value: 'First' })
    expect(result.rows[1]).toEqual({ ID: '2', Value: 'Second' })
    expect(result.rows[2]).toEqual({ ID: '3', Value: 'Third' })
  })

  // Test 4: Handle missing columns gracefully
  it('handles missing columns gracefully', async () => {
    const csvContent = `A,B,C
1,2,3
4,5
6,7,8,9`

    const file = createCsvFile(csvContent)
    const result = await parseCsvFile(file)

    expect(result.headers).toEqual(['A', 'B', 'C'])
    expect(result.rows).toHaveLength(3)
    // Row with missing column should have undefined for that column
    expect(result.rows[0]).toEqual({ A: '1', B: '2', C: '3' })
    expect(result.rows[1]).toEqual({ A: '4', B: '5', C: undefined })
    // Extra columns beyond headers are typically ignored by Papa.parse with header:true
    expect(result.rows[2]).toEqual({ A: '6', B: '7', C: '8' })
  })

  // Test 5: Empty file returns empty rows
  it('handles empty CSV file', async () => {
    const csvContent = ``

    const file = createCsvFile(csvContent)
    const result = await parseCsvFile(file)

    expect(result.headers).toEqual([])
    expect(result.rows).toEqual([])
  })

  // Test 6: CSV with only headers, no data rows
  it('handles CSV with only headers', async () => {
    const csvContent = `Header1,Header2,Header3`

    const file = createCsvFile(csvContent)
    const result = await parseCsvFile(file)

    expect(result.headers).toEqual(['Header1', 'Header2', 'Header3'])
    expect(result.rows).toHaveLength(0)
  })

  // Test 7: Values are returned as strings (no type coercion)
  it('returns all values as strings without type coercion', async () => {
    const csvContent = `Name,Count,Price,Active
Alice,100,19.99,true
Bob,0,0.00,false`

    const file = createCsvFile(csvContent)
    const result = await parseCsvFile(file)

    expect(result.rows[0].Count).toBe('100')
    expect(typeof result.rows[0].Count).toBe('string')
    expect(result.rows[0].Price).toBe('19.99')
    expect(typeof result.rows[0].Price).toBe('string')
    expect(result.rows[0].Active).toBe('true')
    expect(typeof result.rows[0].Active).toBe('string')
  })

  // Test 8: Handles various line endings
  it('handles various line endings (CRLF and LF)', async () => {
    const csvContentCRLF = `Name,Value\r\nAlice,1\r\nBob,2`
    const csvContentLF = `Name,Value\nCharlie,3\nDave,4`

    const fileCRLF = createCsvFile(csvContentCRLF)
    const fileLF = createCsvFile(csvContentLF)

    const resultCRLF = await parseCsvFile(fileCRLF)
    const resultLF = await parseCsvFile(fileLF)

    expect(resultCRLF.rows).toHaveLength(2)
    expect(resultCRLF.rows[0].Name).toBe('Alice')

    expect(resultLF.rows).toHaveLength(2)
    expect(resultLF.rows[0].Name).toBe('Charlie')
  })
})
