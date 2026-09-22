export type Route = { name: 'picker' } | { name: 'categories' } | { name: 'portfolio'; portfolioId: string }

export function parseHash(hash: string): Route {
  if (hash === '#/categories') return { name: 'categories' }
  const match = hash.match(/^#\/portfolio\/(.+)$/)
  if (match) return { name: 'portfolio', portfolioId: decodeURIComponent(match[1]) }
  return { name: 'picker' }
}

export function navigateToPicker(): void {
  window.location.hash = '#/'
}

export function navigateToCategories(): void {
  window.location.hash = '#/categories'
}

export function navigateToPortfolio(portfolioId: string): void {
  window.location.hash = `#/portfolio/${encodeURIComponent(portfolioId)}`
}
