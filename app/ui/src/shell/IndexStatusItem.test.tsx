import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { IndexStatusItem } from './IndexStatusItem'
import { _resetIndexStatusForTests, applyIndexProgress } from '../core/indexStatus'

beforeEach(() => _resetIndexStatusForTests())

describe('IndexStatusItem', () => {
  it('shows nothing without an index', () => {
    const { container } = render(<IndexStatusItem />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the progress while the index builds and hides once ready is old', async () => {
    render(<IndexStatusItem />)
    act(() => applyIndexProgress({ project: 'C:/p', generation: 1, phase: 'reading', done: 2, total: 4, percent: 47, currentFile: 'entity/A/A.aod', message: null }))
    expect(await screen.findByText(/Indexing 47%/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '47')
  })

  it('shows "Index ready" after a very fast build (8% and ready in the same moment)', async () => {
    render(<IndexStatusItem />)
    const base = { project: 'C:/p', generation: 1, currentFile: null, message: null }
    act(() => applyIndexProgress({ ...base, phase: 'reading', done: 1, total: 20, percent: 8, currentFile: 'entity/A/A.aod' }))
    act(() => applyIndexProgress({ ...base, phase: 'ready', done: 172, total: 172, percent: 100, message: '420 ms' }))
    expect(await screen.findByText(/Index ready/)).toBeInTheDocument()
  })
})
