import { fmtUSD } from '../lib/computations'
import type { SankeyLink, SankeyNode } from '../lib/selectors'

export interface BudgetSankeyProps {
  nodes: SankeyNode[]
  links: SankeyLink[]
}

const chartWidth = 1200
const chartHeight = 460

export function BudgetSankey({ nodes, links }: BudgetSankeyProps) {
  if (nodes.length === 0) {
    return (
      <div className="card blueprint elev-sm" data-testid="budget-sankey">
        <div className="card-title">Budget flow</div>
        <div className="text-muted" style={{ fontSize: '12px', paddingTop: 'var(--space-3)' }}>
          No budget flow for this period.
        </div>
      </div>
    )
  }

  return (
    <div className="card blueprint elev-sm" data-testid="budget-sankey">
      <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Budget flow</div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ position: 'relative', width: `${chartWidth}px`, height: `${chartHeight}px` }}>
          <svg
            aria-label="Budget flow chart"
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            width={chartWidth}
            height={chartHeight}
            style={{ display: 'block' }}
          >
            {links.map((link) => (
              <path key={`${link.sourceId}-${link.targetId}-${link.title}`} d={link.d} fill="var(--color-accent)" opacity={link.opacity}>
                <title>{link.title}</title>
              </path>
            ))}
            {nodes.map((node) => (
              <rect key={node.id} x={node.x} y={node.y} width={node.width} height={node.height} fill="var(--color-accent)">
                <title>{`${node.label}: ${fmtUSD(node.value)}`}</title>
              </rect>
            ))}
          </svg>
          {nodes.map((node) => {
            const isIncome = node.column === 'income'
            const isBudget = node.column === 'budget'
            return (
              <div
                key={node.id}
                style={{
                  position: 'absolute',
                  top: `${node.y + node.height / 2}px`,
                  left: `${isIncome ? node.x + node.width + 10 : isBudget ? node.x - 10 : node.x + node.width + 10}px`,
                  transform: `translate(${isBudget ? '-100%' : '0'}, -50%)`,
                  fontSize: '12px',
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                  textAlign: isBudget ? 'right' : 'left',
                  pointerEvents: 'none',
                }}
              >
                <div>{node.label}</div>
                <div className="text-muted">{fmtUSD(node.value)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
