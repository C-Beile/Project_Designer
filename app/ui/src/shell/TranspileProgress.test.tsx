import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TranspileProgress } from './TranspileProgress'

describe('TranspileProgress', () => {
  it('shows a running bar and a dimmed Cancel while the build cannot be aborted', () => {
    render(<TranspileProgress label="Transpiling (official)..." />)
    expect(screen.getByRole('status', { name: 'Transpiling...' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the percentage and the running stage when the engine reports its progress', () => {
    render(<TranspileProgress label="Transpiling (experimental)..." progress={{ percent: 42, stage: 'Applying the modifications' }} />)
    expect(screen.getByText('Transpiling... 42 %')).toBeInTheDocument()
    expect(screen.getByText('Applying the modifications')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(bar).not.toHaveAttribute('aria-busy')
  })
})
