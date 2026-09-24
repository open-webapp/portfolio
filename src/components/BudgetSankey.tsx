import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtUSD } from '../lib/computations'
import { sankeyFlowData } from '../lib/selectors'
import type { SpendScope } from '../lib/selectors'
import type { BudgetTransaction, Category, ExpenseDefinition } from '../lib/types'

export interface BudgetSankeyProps {
  definitions: ExpenseDefinition[]
  amountsByYear: Record<string, Record<string, number>>
  transactions: BudgetTransaction[]
  categories: Category[]
  scope: SpendScope
}

const minChartHeight = 460
const chartBottomPadding = 40

export function BudgetSankey({ definitions, amountsByYear, transactions, categories, scope }: BudgetSankeyProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const resizeTimeoutRef = useRef<number | undefined>(undefined)
  const [measuredWidth, setMeasuredWidth] = useState(1200)

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const el = wrapperRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      if (resizeTimeoutRef.current !== undefined) {
        window.clearTimeout(resizeTimeoutRef.current)
      }
      resizeTimeoutRef.current = window.setTimeout(() => {
        setMeasuredWidth(entry.contentRect.width)
      }, 120)
    })
    observer.observe(el)

    return () => {
      observer.disconnect()
      if (resizeTimeoutRef.current !== undefined) {
        window.clearTimeout(resizeTimeoutRef.current)
      }
    }
  }, [])

  const width = Math.min(1600, Math.max(640, measuredWidth))
  const chartWidth = width

  const { nodes, links } = useMemo(
    () => sankeyFlowData(definitions, amountsByYear, transactions, categories, scope, width),
    [definitions, amountsByYear, transactions, categories, scope, width]
  )

  if (nodes.length === 0) {
    return (
      <div className="card blueprint elev-sm" data-testid="budget-sankey" ref={wrapperRef}>
        <div className="card-title">Budget flow</div>
        <div className="text-muted" style={{ fontSize: '12px', paddingTop: 'var(--space-3)' }}>
          No budget flow for this period.
        </div>
      </div>
    )
  }

  const chartHeight = Math.max(minChartHeight, ...nodes.map((node) => node.y + node.height + chartBottomPadding))

  return (
    <div className="card blueprint elev-sm" data-testid="budget-sankey" ref={wrapperRef}>
      <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Budget flow</div>
      <div style={{ maxHeight: '720px', overflow: 'auto' }}>
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
