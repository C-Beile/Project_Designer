import { describe, expect, it } from 'vitest'
import { markPerf } from './marks'
import { takePerfSnapshot } from './perfSnapshot'

describe('perf snapshot', () => {
  it('lists the designer marks and counts the DOM', () => {
    markPerf('first-render')
    const snap = takePerfSnapshot()
    expect(Object.keys(snap.marks)).toContain('first-render')
    expect(snap.domNodes).toBeGreaterThan(0)
    expect(snap.window).toContain('/')
  })
})
