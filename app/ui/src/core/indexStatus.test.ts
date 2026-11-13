import { beforeEach, describe, expect, it } from 'vitest'
import { _resetIndexStatusForTests, applyIndexProgress, getIndexState, summarizeIndex } from './indexStatus'
import { clearNotifications, getNotifications } from './notifications'
import type { IndexProgress } from '../wire/types'

const p = (over: Partial<IndexProgress>): IndexProgress => ({ project: 'C:/p', generation: 1, phase: 'reading', done: 1, total: 4, percent: 26, currentFile: 'entity/A/A.aod', message: null, ...over })

beforeEach(() => {
  _resetIndexStatusForTests()
  clearNotifications()
})

describe('index status store', () => {
  it('ignores events of an older generation', () => {
    applyIndexProgress(p({ generation: 2, done: 3 }))
    applyIndexProgress(p({ generation: 1, done: 4 }))
    expect(getIndexState().projects['C:/p'].done).toBe(3)
  })

  it('shows percent and file while reading, a stripe while listing', () => {
    applyIndexProgress(p({ percent: 45 }))
    const s = summarizeIndex(Object.values(getIndexState().projects), 0)!
    expect(s.text).toBe('Indexing 45%  entity/A/A.aod')
    expect(s.percent).toBe(45)
    applyIndexProgress(p({ phase: 'listing', percent: null, done: 1234, total: 0, currentFile: null }))
    const l = summarizeIndex(Object.values(getIndexState().projects), 0)!
    expect(l.text).toBe('Indexing... 1234 files')
    expect(l.percent).toBeNull()
  })

  it('sums several projects and keeps "ready" visible for 5 seconds only', () => {
    applyIndexProgress(p({ project: 'a', percent: 20 }))
    applyIndexProgress(p({ project: 'b', percent: 60 }))
    expect(summarizeIndex(Object.values(getIndexState().projects), 0)!.percent).toBe(40)
    applyIndexProgress(p({ project: 'a', phase: 'ready', percent: 100, message: '2500 ms' }), () => 1000)
    applyIndexProgress(p({ project: 'b', phase: 'ready', percent: 100, message: '1000 ms' }), () => 1000)
    const ready = summarizeIndex(Object.values(getIndexState().projects), 2000)!
    expect(ready.text).toBe('Index ready (3.5 s)')
    expect(summarizeIndex(Object.values(getIndexState().projects), 6500)).toBeNull()
  })

  it('announces the end of a build with a notification, but not a replayed ready state', () => {
    applyIndexProgress(p({ phase: 'ready', done: 172, percent: 100, message: '420 ms' }))
    expect(getNotifications()).toHaveLength(0)
    applyIndexProgress(p({ generation: 2, percent: 8 }))
    applyIndexProgress(p({ generation: 2, phase: 'ready', done: 172, percent: 100, message: '420 ms' }))
    expect(getNotifications().map((n) => n.text)).toEqual(['Index ready: p, 172 objects in 0.4 s'])
  })
})
