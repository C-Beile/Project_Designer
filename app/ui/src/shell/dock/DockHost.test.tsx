import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { defaultLayout, type LayoutState } from '../layoutState'
import { DockHost, type PanelContent } from './DockHost'

const panel = (name: string): PanelContent => ({ header: null, title: name, body: <p>{`${name} body`}</p> })
const PANELS = { projects: panel('Projects'), properties: panel('Properties'), navigator: panel('Navigator'), output: panel('Output') }

function Harness({ start, seen }: { start: LayoutState; seen: LayoutState[] }) {
  const [layout, setLayout] = useState(start)
  seen[0] = layout
  return <DockHost layout={layout} onLayoutChange={setLayout} panels={PANELS} editor={<p>editor area</p>} />
}

describe('DockHost', () => {
  it('shows the editor and every open panel', async () => {
    render(<Harness start={defaultLayout()} seen={[]} />)
    expect(await screen.findByText('editor area')).toBeInTheDocument()
    for (const name of ['Projects', 'Properties', 'Navigator', 'Output']) expect(await screen.findByText(`${name} body`)).toBeInTheDocument()
  })

  it('the close button of a tab closes the panel and records it in the layout', async () => {
    const seen: LayoutState[] = []
    render(<Harness start={defaultLayout()} seen={seen} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Close Navigator' }))
    expect(screen.queryByText('Navigator body')).toBeNull()
    expect(seen[0].panels.navigator).toBe('closed')
  })

  it('opens a panel that the layout marks open again', async () => {
    const closed = { ...defaultLayout(), panels: { ...defaultLayout().panels, output: 'closed' as const } }
    render(<Harness start={closed} seen={[]} />)
    await screen.findByText('editor area')
    expect(screen.queryByText('Output body')).toBeNull()
  })

  it('falls back to the default arrangement when the stored grid is damaged', async () => {
    render(<Harness start={{ ...defaultLayout(), dock: { grid: 'kaputt' } }} seen={[]} />)
    expect(await screen.findByText('Projects body')).toBeInTheDocument()
    expect(await screen.findByText('editor area')).toBeInTheDocument()
  })
})

describe('DockHost reset', () => {
  it('a new reset value rebuilds the arrangement and keeps every open panel', async () => {
    function ResetHarness() {
      const [layout, setLayout] = useState<LayoutState>({ ...defaultLayout(), dock: { grid: 'kaputt' } })
      return (
        <>
          <button onClick={() => setLayout({ ...defaultLayout(), reset: Date.now() })}>reset</button>
          <DockHost layout={layout} onLayoutChange={setLayout} panels={PANELS} editor={<p>editor area</p>} />
        </>
      )
    }
    render(<ResetHarness />)
    await screen.findByText('Navigator body')
    await userEvent.click(screen.getByRole('button', { name: 'reset' }))
    expect(await screen.findByText('Navigator body')).toBeInTheDocument()
    expect(screen.getByText('editor area')).toBeInTheDocument()
  })
})

describe('panels of plugins', () => {
  it('a registered panel shows up in the dock and Window > its title toggles it', async () => {
    const { registerPanel, _resetPanelsForTests } = await import('../../core/contrib/panels')
    const { runCommandById } = await import('../../core/plugins/registry')
    const off = registerPanel({ id: 'demo', title: 'Demo', area: 'right', group: 'right-demo', opens: 'startup', component: () => <p>demo body</p> })
    function Plugged() {
      const [layout, setLayout] = useState<LayoutState>(defaultLayout())
      return <DockHost layout={layout} onLayoutChange={setLayout} panels={PANELS} editor={<p>editor area</p>} />
    }
    render(<Plugged />)
    expect(await screen.findByText('demo body')).toBeInTheDocument()
    await act(async () => void runCommandById('window.panel.demo'))
    await waitFor(() => expect(screen.queryByText('demo body')).toBeNull())
    await act(async () => void runCommandById('window.panel.demo'))
    expect(await screen.findByText('demo body')).toBeInTheDocument()
    off()
    _resetPanelsForTests()
  })
})
