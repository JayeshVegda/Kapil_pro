import { describe, expect, it } from 'vitest'
import { Children, isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Sparkline } from '@/components/charts/sparkline'
import { StackedBar } from '@/components/charts/stacked-bar'
import { DeltaChip } from '@/components/charts/delta-chip'
import { DashboardToolbar } from '@/components/ui/dashboard-toolbar'
import { KpiCard, SectionCard } from '@/components/ui/business-kit'
import { Panel } from '@/components/ui/panel'

/**
 * Validates a React dashboard element tree against the Cards Rule.
 * Invariant: Every direct child of the container must be a card
 * (or a grid/stack container whose direct children are all cards).
 */
export function validateCardsRule(container: ReactElement<any>): { valid: boolean; violations: string[] } {
  const containerProps = container.props as Record<string, any> | undefined
  const children = Children.toArray(containerProps?.children)
  const violations: string[] = []

  const isCardComponent = (element: unknown): boolean => {
    if (!isValidElement(element)) return false
    const props = element.props as Record<string, any> | undefined
    return (
      props?.['data-card'] === 'true' ||
      element.type === KpiCard ||
      element.type === SectionCard ||
      element.type === Panel ||
      element.type === DashboardToolbar
    )
  }

  for (const child of children) {
    if (!isValidElement(child)) {
      violations.push(String(child))
      continue
    }

    if (isCardComponent(child)) continue

    // If it's a grid/flex wrapper, its direct children must all be cards
    const childProps = child.props as Record<string, any> | undefined
    const className = String(childProps?.className ?? '')
    const isGridOrStack = className.includes('grid') || className.includes('space-y') || className.includes('flex')
    if (isGridOrStack && childProps?.children) {
      const grandchildren = Children.toArray(childProps.children)
      const allCards = grandchildren.length > 0 && grandchildren.every(isCardComponent)
      if (allCards) continue
    }

    const name =
      typeof child.type === 'string'
        ? child.type
        : ((child.type as { name?: string }).name ?? 'unknown')
    violations.push(name)
  }

  return { valid: violations.length === 0, violations }
}

describe('Chart Kit Visuals & Cards Rule', () => {
  describe('Sparkline', () => {
    it('hides completely under 2 points', () => {
      expect(renderToStaticMarkup(<Sparkline values={[]} />)).toBe('')
      expect(renderToStaticMarkup(<Sparkline values={[100]} />)).toBe('')
    })

    it('renders SVG polyline when 2 or more points are provided', () => {
      const html = renderToStaticMarkup(<Sparkline values={[10, 25, 18, 40]} />)
      expect(html).toContain('<svg')
      expect(html).toContain('<polyline')
      expect(html).toContain('<circle')
    })
  })

  describe('StackedBar', () => {
    it('handles all-zero segments gracefully without division by zero', () => {
      const segments = [
        { key: '0_30', label: '0-30d', value: 0, color: '#ccc' },
        { key: '31_60', label: '31-60d', value: 0, color: '#f59e0b' },
      ]
      const html = renderToStaticMarkup(<StackedBar segments={segments} />)
      expect(html).not.toContain('NaN')
      expect(html).toContain('No distribution data available')
    })

    it('renders proportional segments when values exist', () => {
      const segments = [
        { key: 'a', label: 'A', value: 100, color: '#1e293b' },
        { key: 'b', label: 'B', value: 300, color: '#059669' },
      ]
      const html = renderToStaticMarkup(<StackedBar segments={segments} />)
      expect(html).toContain('width:25.0%')
      expect(html).toContain('width:75.0%')
      expect(html).toContain('(25%)')
      expect(html).toContain('(75%)')
    })
  })

  describe('DeltaChip', () => {
    it('hides when delta is null, undefined, or missing', () => {
      expect(renderToStaticMarkup(<DeltaChip delta={null} />)).toBe('')
      expect(renderToStaticMarkup(<DeltaChip delta={undefined} />)).toBe('')
    })

    it('renders green positive chip for goodDirection=up', () => {
      const html = renderToStaticMarkup(<DeltaChip delta={12.5} goodDirection="up" />)
      expect(html).toContain('+12.5%')
      expect(html).toContain('text-emerald-700')
    })

    it('renders red positive chip for goodDirection=down (e.g. costs)', () => {
      const html = renderToStaticMarkup(<DeltaChip delta={8.0} goodDirection="down" />)
      expect(html).toContain('+8%')
      expect(html).toContain('text-rose-700')
    })
  })

  describe('Cards Rule Enforcement', () => {
    it('attaches data-card="true" to all standard card containers', () => {
      expect(renderToStaticMarkup(<Panel>Content</Panel>)).toContain('data-card="true"')
      expect(renderToStaticMarkup(<SectionCard title="Title">Content</SectionCard>)).toContain('data-card="true"')
      expect(renderToStaticMarkup(<KpiCard label="Sales" value="100" />)).toContain('data-card="true"')
      expect(
        renderToStaticMarkup(
          <DashboardToolbar mode="month" onModeChange={() => {}} />,
        ),
      ).toContain('data-card="true"')
    })

    it('passes the Cards Rule when all elements in the container are cards or card grids', () => {
      const conformingDashboard = (
        <div id="dashboard-container" className="space-y-4">
          <DashboardToolbar mode="month" onModeChange={() => {}} />
          <div className="grid grid-cols-2 gap-4">
            <KpiCard label="Billed" value="100" />
            <KpiCard label="Collected" value="80" />
          </div>
          <SectionCard title="Section 1">
            <p>Inner content is allowed inside a card</p>
          </SectionCard>
        </div>
      )

      const result = validateCardsRule(conformingDashboard)
      expect(result.valid).toBe(true)
      expect(result.violations).toHaveLength(0)
    })

    it('fails the Cards Rule when bare floating elements sit directly on the background', () => {
      const nonConformingDashboard = (
        <div id="dashboard-container" className="space-y-4">
          <h1>Bare Title Floating</h1>
          <p>Bare text floating</p>
          <SectionCard title="Legal Card">Content</SectionCard>
        </div>
      )

      const result = validateCardsRule(nonConformingDashboard)
      expect(result.valid).toBe(false)
      expect(result.violations).toEqual(['h1', 'p'])
    })
  })
})
