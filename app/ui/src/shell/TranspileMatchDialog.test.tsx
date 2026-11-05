import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TranspileMatchDialog } from './TranspileMatchDialog'
import { TranspileResult } from './TranspileProgress'

const REPORT = {
  total: 200,
  identical: 199,
  missing: 0,
  different: 1,
  own_only: 3,
  percent: 99.5,
  groups: [{ folder: 'entity', kind: '.aod', reason: 'different' as const, count: 1, example: 'entity/A/A.aod' }],
}

describe('TranspileMatchDialog', () => {
  it('shows the percentage, the counts and the groups that still differ', () => {
    render(<TranspileMatchDialog report={REPORT} reference="C:/ref/dist" onChangeReference={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByLabelText('Match')).toHaveTextContent('99.50 %')
    expect(screen.getByRole('progressbar', { name: 'Match with the reference' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText('entity/A/A.aod')).toBeInTheDocument()
    expect(screen.getByText(/3 exist only/)).toBeInTheDocument()
  })
})

describe('TranspileResult', () => {
  it('shows the match once it is known and opens the details from it', () => {
    const onShowMatch = vi.fn()
    render(<TranspileResult result={{ ok: true, seconds: '4.2', project: 'C:/p/x', match: 99.55 }} onDeploy={vi.fn()} onShowOutput={vi.fn()} onShowMatch={onShowMatch} onClose={vi.fn()} />)
    screen.getByRole('button', { name: 'Show the match with the reference' }).click()
    expect(onShowMatch).toHaveBeenCalled()
  })

  it('shows no match line without a reference', () => {
    render(<TranspileResult result={{ ok: true, seconds: '4.2', project: 'C:/p/x' }} onDeploy={vi.fn()} onShowOutput={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByText(/Match with the reference/)).toBeNull()
  })
})
