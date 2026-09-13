export type Route = { name: 'picker' } | { name: 'portfolio'; portfolioId: string }

export function parseHash(hash: string): Route {
  const match = hash.match(/^#\/portfolio\/(.+)$/)
  if (match) return { name: 'portfolio', portfolioId: decodeURIComponent(match[1]) }
  return { name: 'picker' }
}

export function navigateToPicker(): void {
  window.location.hash = '#/'
}

export function navigateToPortfolio(portfolioId: string): void {
  window.location.hash = `#/portfolio/${encodeURIComponent(portfolioId)}`
}
