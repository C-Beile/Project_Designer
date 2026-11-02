import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TranspileProgress } from './TranspileProgress'

describe('TranspileProgress', () => {
  it('shows a running bar and a dimmed Cancel while the build cannot be aborted', () => {
    render(<TranspileProgress label="Transpiling (official)..." />)
    expect(screen.getByRole('dialog', { name: 'Transpiling...' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
