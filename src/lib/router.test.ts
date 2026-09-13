import { describe, expect, it, afterEach } from 'vitest'
import { parseHash, navigateToPortfolio } from './router'

describe('parseHash', () => {
  it('parses a portfolio hash', () => {
    expect(parseHash('#/portfolio/port-abc123')).toEqual({
      name: 'portfolio',
      portfolioId: 'port-abc123',
    })
  })

  it('treats empty string as picker', () => {
    expect(parseHash('')).toEqual({ name: 'picker' })
  })

  it('treats "#/" as picker', () => {
    expect(parseHash('#/')).toEqual({ name: 'picker' })
  })

  it('treats "#/portfolio/" (trailing slash, empty id) as picker', () => {
    expect(parseHash('#/portfolio/')).toEqual({ name: 'picker' })
  })
})

describe('navigateToPortfolio', () => {
  const originalHash = window.location.hash

  afterEach(() => {
    window.location.hash = originalHash
  })

  it('encodes the portfolioId and round-trips through parseHash', () => {
    navigateToPortfolio('port-a b')
    const hash = window.location.hash
    expect(hash).toBe('#/portfolio/port-a%20b')
    expect(parseHash(hash)).toEqual({ name: 'portfolio', portfolioId: 'port-a b' })
  })
})
