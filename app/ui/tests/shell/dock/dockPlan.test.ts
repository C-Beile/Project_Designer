import { describe, expect, it } from 'vitest'
import { layoutConfig } from '../../../src/config/layoutConfig'
import { planDock } from '../../../src/shell/dock/dockPlan'

const startup = layoutConfig.panels.map((p) => ({ ...p, opens: 'startup' as const }))
const base = { panels: startup, areas: layoutConfig.areas, centerId: 'editor', windowWidth: 1920, windowHeight: 1080, uiFactor: 1 }

describe('planDock with the default layout.toml', () => {
  const plan = planDock(base)
  const of = (id: string) => plan.find((p) => p.id === id)!

  it('puts Navigator right of the editor, Output below the editor only and Projects left at the window edge', () => {
    expect(of('navigator')).toMatchObject({ direction: 'right', reference: 'editor' })
    expect(of('output')).toMatchObject({ direction: 'below', reference: 'editor' })
    expect(of('projects')).toMatchObject({ direction: 'left', reference: undefined })
  })

  it('adds the left edge last so it runs the full height, and stacks Properties under Projects', () => {
    expect(plan.map((p) => p.id)).toEqual(['navigator', 'output', 'projects', 'properties'])
    expect(of('properties')).toMatchObject({ direction: 'below', reference: 'projects' })
  })

  it('takes sizes from the area, scales them with the UI factor and respects the maximum percent', () => {
    expect(of('projects').width).toBe(340)
    expect(planDock({ ...base, uiFactor: 1.5 }).find((p) => p.id === 'projects')!.width).toBe(510)
    expect(planDock({ ...base, windowWidth: 600 }).find((p) => p.id === 'projects')!.width).toBe(240)
    expect(of('output').height).toBe(240)
  })

  it('puts panels of one group into tabs', () => {
    const tabs = layoutConfig.panels.map((p) => (p.id === 'properties' ? { ...p, group: 'left-top' } : p))
    expect(planDock({ ...base, panels: tabs }).find((p) => p.id === 'properties')).toMatchObject({ direction: 'within', reference: 'projects' })
  })

  it('leaves out panels that open on demand', () => {
    const onDemand = layoutConfig.panels.map((p) => (p.id === 'output' ? { ...p, opens: 'on-demand' as const } : p))
    expect(planDock({ ...base, panels: onDemand }).some((p) => p.id === 'output')).toBe(false)
  })
})
