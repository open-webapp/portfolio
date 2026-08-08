import { describe, it, expect } from 'vitest'
import {
  createProfile,
  updateProfile,
  deleteProfile,
  listProfilesForKind,
  applyMapping,
  validateProfile,
} from './mappingProfiles'
import type { MappingProfile } from './types'

describe('mappingProfiles', () => {
  // Test 1: createProfile produces fresh uid and createdAt === updatedAt
  it('createProfile produces fresh uid and createdAt === updatedAt', () => {
    const profile = createProfile(
      'My Positions Profile',
      'positions',
      { Symbol: 'symbol', Name: 'name', Class: 'assetClass', Qty: 'shares', Cost: 'avgCost', Price: 'price' }
    )

    expect(profile.id).toMatch(/^map-/) // starts with 'map-' prefix
    expect(profile.id).toHaveLength(11) // 'map-' + 7 chars from uid
    expect(profile.name).toBe('My Positions Profile')
    expect(profile.kind).toBe('positions')
    expect(profile.createdAt).toBe(profile.updatedAt)
    expect(profile.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/) // ISO date format
  })

  // Test 2: validateProfile fails when required field is unmapped
  it('validateProfile fails when required field is unmapped', () => {
    const profile = createProfile(
      'Incomplete Profile',
      'positions',
      { Symbol: 'symbol', Name: 'name' } // missing assetClass, shares, avgCost/purchaseAmount, price/marketValue
    )

    const result = validateProfile(profile, 'positions')

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors).toContain("Required field 'assetClass' is not mapped")
    expect(result.errors).toContain("Required field 'shares' is not mapped")
    expect(result.errors).toContain("Either 'avgCost' OR 'purchaseAmount' must be mapped (not both missing)")
    expect(result.errors).toContain("Either 'price' OR 'marketValue' must be mapped (not both missing)")
  })

  // Test 3: validateProfile passes when all required fields are mapped
  it('validateProfile passes when all required fields are mapped', () => {
    const profile = createProfile(
      'Complete Profile',
      'positions',
      {
        Symbol: 'symbol',
        Name: 'name',
        Class: 'assetClass',
        Qty: 'shares',
        Cost: 'avgCost',
        Price: 'price',
      }
    )

    const result = validateProfile(profile, 'positions')

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  // Test 4: applyMapping renames CSV headers per fieldMap
  it('applyMapping renames CSV headers per fieldMap', () => {
    const profile = createProfile('Test Profile', 'positions', {
      Symbol: 'symbol',
      Name: 'name',
      Class: 'assetClass',
      Qty: 'shares',
      Cost: 'avgCost',
      Price: 'price',
    })

    const csvRow = {
      Symbol: 'AAPL',
      Name: 'Apple Inc.',
      Class: 'Equity',
      Qty: '100',
      Cost: '150.25',
      Price: '180.50',
    }

    const mapped = applyMapping(csvRow, profile)

    expect(mapped.symbol).toBe('AAPL')
    expect(mapped.name).toBe('Apple Inc.')
    expect(mapped.assetClass).toBe('Equity')
    expect(mapped.shares).toBe('100')
    expect(mapped.avgCost).toBe('150.25')
    expect(mapped.price).toBe('180.50')
    // Original keys should not be in mapped object
    expect(mapped.Symbol).toBeUndefined()
    expect(mapped.Name).toBeUndefined()
  })

  // Test 5: listProfilesForKind filters correctly by kind
  it('listProfilesForKind filters correctly by kind', () => {
    const posProfile1 = createProfile('Positions 1', 'positions', {})
    const posProfile2 = createProfile('Positions 2', 'positions', {})
    const txProfile = createProfile('Transactions 1', 'transactions', {})

    const profiles = [posProfile1, posProfile2, txProfile]

    const posProfiles = listProfilesForKind(profiles, 'positions')
    const txProfiles = listProfilesForKind(profiles, 'transactions')

    expect(posProfiles).toHaveLength(2)
    expect(txProfiles).toHaveLength(1)
    expect(posProfiles[0].name).toBe('Positions 1')
    expect(posProfiles[1].name).toBe('Positions 2')
    expect(txProfiles[0].name).toBe('Transactions 1')
  })

  // Test 6: Round-trip: createProfile → applyMapping → mapped row has all required keys
  it('Round-trip: createProfile → applyMapping → mapped row has all required keys', () => {
    // Create a complete mapping profile
    const profile = createProfile('Complete Mapping', 'positions', {
      Ticker: 'symbol',
      CompanyName: 'name',
      AssetType: 'assetClass',
      Quantity: 'shares',
      AverageCost: 'avgCost',
      CurrentPrice: 'price',
    })

    // Simulate a CSV row with different header names
    const csvRow = {
      Ticker: 'GOOGL',
      CompanyName: 'Alphabet Inc.',
      AssetType: 'Equity',
      Quantity: '50',
      AverageCost: '2500.00',
      CurrentPrice: '2800.00',
    }

    // Apply the mapping
    const mapped = applyMapping(csvRow, profile)

    // Verify all required fields are present
    const requiredFields = ['symbol', 'name', 'assetClass', 'shares', 'avgCost', 'price']
    for (const field of requiredFields) {
      expect(mapped[field]).toBeDefined()
      expect(mapped[field]).not.toBe('')
    }

    // Verify values are correct
    expect(mapped.symbol).toBe('GOOGL')
    expect(mapped.name).toBe('Alphabet Inc.')
  })

  // Additional test: updateProfile updates fields and timestamp
  it('updateProfile updates fields and timestamp', (done) => {
    const profile = createProfile('Original Name', 'positions', {
      Symbol: 'symbol',
    })

    const originalTimestamp = profile.updatedAt

    // Wait a tiny bit to ensure time difference
    setTimeout(() => {
      const updated = updateProfile(profile, 'Updated Name', {
        Symbol: 'symbol',
        Name: 'name',
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.fieldMap.Name).toBe('name')
      expect(updated.updatedAt).not.toBe(originalTimestamp)
      expect(updated.createdAt).toBe(profile.createdAt) // createdAt should not change
      expect(updated.id).toBe(profile.id) // id should not change
      done()
    }, 10)
  })

  // Additional test: deleteProfile removes profile by id
  it('deleteProfile removes profile by id', () => {
    const profile1 = createProfile('Profile 1', 'positions', {})
    const profile2 = createProfile('Profile 2', 'positions', {})
    const profile3 = createProfile('Profile 3', 'transactions', {})

    const profiles = [profile1, profile2, profile3]

    const afterDelete = deleteProfile(profiles, profile2.id)

    expect(afterDelete).toHaveLength(2)
    expect(afterDelete.some((p) => p.id === profile2.id)).toBe(false)
    expect(afterDelete.some((p) => p.id === profile1.id)).toBe(true)
    expect(afterDelete.some((p) => p.id === profile3.id)).toBe(true)
  })

  // Additional test: applyMapping with accountNumberColumn
  it('applyMapping handles accountNumberColumn in profile', () => {
    const profile = createProfile(
      'With Account',
      'positions',
      {
        Symbol: 'symbol',
        Name: 'name',
        Class: 'assetClass',
        Qty: 'shares',
        Cost: 'avgCost',
        Price: 'price',
      },
      'AccountNum' // accountNumberColumn in CSV
    )

    const csvRow = {
      AccountNum: 'ACC-123',
      Symbol: 'MSFT',
      Name: 'Microsoft',
      Class: 'Equity',
      Qty: '25',
      Cost: '300.00',
      Price: '350.00',
    }

    const mapped = applyMapping(csvRow, profile)

    // accountNumberColumn field should also be mapped if present
    expect(mapped.symbol).toBe('MSFT')
    expect(mapped.name).toBe('Microsoft')
    // If AccountNum is not explicitly in fieldMap, it won't be mapped
    // But the profile knows about it via accountNumberColumn property
    expect(profile.accountNumberColumn).toBe('AccountNum')
  })

  // Additional test: validateProfile for transactions kind
  it('validateProfile works correctly for transactions kind', () => {
    const profile = createProfile(
      'Transaction Profile',
      'transactions',
      {
        TransDate: 'date',
        Ticker: 'symbol',
        TxType: 'type',
        Qty: 'shares',
        Price: 'price',
        Amount: 'amount',
      }
    )

    const result = validateProfile(profile, 'transactions')

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  // Test: validateProfile accepts purchaseAmount as alternative to avgCost
  it('validateProfile accepts purchaseAmount as alternative to avgCost', () => {
    const profile = createProfile(
      'Profile with purchaseAmount',
      'positions',
      {
        Symbol: 'symbol',
        Name: 'name',
        Class: 'assetClass',
        Qty: 'shares',
        Amount: 'purchaseAmount',
        Price: 'price',
      }
    )

    const result = validateProfile(profile, 'positions')

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  // Test: validateProfile accepts marketValue as alternative to price
  it('validateProfile accepts marketValue as alternative to price', () => {
    const profile = createProfile(
      'Profile with marketValue',
      'positions',
      {
        Symbol: 'symbol',
        Name: 'name',
        Class: 'assetClass',
        Qty: 'shares',
        Cost: 'avgCost',
        MarketVal: 'marketValue',
      }
    )

    const result = validateProfile(profile, 'positions')

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  // Test: validateProfile warns when both avgCost and purchaseAmount are mapped
  it('validateProfile warns when both avgCost and purchaseAmount are mapped', () => {
    const profile = createProfile(
      'Profile with both cost alternatives',
      'positions',
      {
        Symbol: 'symbol',
        Name: 'name',
        Class: 'assetClass',
        Qty: 'shares',
        AvgCost: 'avgCost',
        PurchaseAmount: 'purchaseAmount',
        Price: 'price',
      }
    )

    const result = validateProfile(profile, 'positions')

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toBeDefined()
    expect(result.warnings).toContain("Both 'avgCost' and 'purchaseAmount' are mapped; will prefer 'avgCost' during import")
  })

  // Test: validateProfile warns when both price and marketValue are mapped
  it('validateProfile warns when both price and marketValue are mapped', () => {
    const profile = createProfile(
      'Profile with both price alternatives',
      'positions',
      {
        Symbol: 'symbol',
        Name: 'name',
        Class: 'assetClass',
        Qty: 'shares',
        Cost: 'avgCost',
        Price: 'price',
        MarketVal: 'marketValue',
      }
    )

    const result = validateProfile(profile, 'positions')

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toBeDefined()
    expect(result.warnings).toContain("Both 'price' and 'marketValue' are mapped; will prefer 'price' during import")
  })

  // Test: validateProfile warns when both alternatives are present for both fields
  it('validateProfile warns for both alternative pairs when present', () => {
    const profile = createProfile(
      'Profile with all alternatives',
      'positions',
      {
        Symbol: 'symbol',
        Name: 'name',
        Class: 'assetClass',
        Qty: 'shares',
        AvgCost: 'avgCost',
        PurchaseAmount: 'purchaseAmount',
        Price: 'price',
        MarketVal: 'marketValue',
      }
    )

    const result = validateProfile(profile, 'positions')

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toBeDefined()
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings).toContain("Both 'avgCost' and 'purchaseAmount' are mapped; will prefer 'avgCost' during import")
    expect(result.warnings).toContain("Both 'price' and 'marketValue' are mapped; will prefer 'price' during import")
  })
})
