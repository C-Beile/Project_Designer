import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ActiveProjectBar } from '../../src/shell/ProjectsPanel'

describe('active project bar', () => {
  it('names the project that is being edited', () => {
    render(<ActiveProjectBar path="C:/work/SVB" count={2} />)
    expect(screen.getByText('SVB')).toBeInTheDocument()
    expect(screen.getByLabelText('Active project: SVB')).toHaveAttribute('title', 'C:/work/SVB')
  })

  it('stays away without an open project', () => {
    const { container } = render(<ActiveProjectBar path="" count={0} />)
    expect(container).toBeEmptyDOMElement()
  })
})
