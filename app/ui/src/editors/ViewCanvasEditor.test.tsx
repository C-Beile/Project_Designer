import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViewCanvasEditor } from './ViewCanvasEditor'
import type { WireValue } from '../wire/types'
import { createMockForgeApi } from '../test/mockApi'

// Mirrors THHIT_ActivityMain_view.aod's real shape (app/core/tests/fixtures/DemoProject/neonView)
// - two references, the second one is the layout's master.
function sampleView(): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: { kind: 'text', value: 'THHIT_ActivityMain_view' } },
      {
        key: 'layout',
        value: {
          kind: 'object',
          fields: [
            {
              key: 'masterSlaveLayout',
              value: {
                kind: 'object',
                fields: [{ key: 'master', value: { kind: 'text', value: 'aba154fa-0375-4b3b-9427-e3e5c6fbed46' } }],
              },
            },
          ],
        },
      },
      {
        key: 'children',
        value: {
          kind: 'object',
          fields: [
            {
              key: 'neonViewReference',
              value: {
                kind: 'array',
                items: [
                  {
                    kind: 'object',
                    fields: [
                      { key: 'name', value: { kind: 'text', value: '62648554-04b1-4461-bba3-a089a0f7ff92' } },
                      { key: 'entityField', value: { kind: 'text', value: '#ENTITY' } },
                      { key: 'view', value: { kind: 'text', value: 'THHIT_ActivityDetail_view' } },
                    ],
                  },
                  {
                    kind: 'object',
                    fields: [
                      { key: 'name', value: { kind: 'text', value: 'aba154fa-0375-4b3b-9427-e3e5c6fbed46' } },
                      { key: 'entityField', value: { kind: 'text', value: '#ENTITY' } },
                      { key: 'view', value: { kind: 'text', value: 'THHIT_ActivityPreview_view' } },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  }
}

function Harness({ api }: { api: ReturnType<typeof createMockForgeApi> }) {
  const [tree, setTree] = useState(sampleView())
  return <ViewCanvasEditor nodeId="node-1" projectRoot="C:/demo" tree={tree} api={api} onTreeChange={setTree} />
}

describe('ViewCanvasEditor (Ziel 1 + "Fertig"-Kriterium 3)', () => {
  it('renders the view name, master indicator and reference rows', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleView() } })
    render(<Harness api={api} />)
    await user.click(screen.getByRole('button', { name: 'Structure' }))

    expect(screen.getByText('THHIT_ActivityMain_view')).toBeInTheDocument()
    expect(screen.getByLabelText('Reference 0 entity field')).toHaveValue('#ENTITY')
    expect(screen.getByLabelText('Reference 1 view')).toHaveValue('THHIT_ActivityPreview_view')
    // Only the second row (matching the layout master uuid) carries the master marker.
    const rows = screen.getAllByRole('row')
    expect(rows[1]).not.toHaveTextContent('\u2605') // header row is rows[0]
    expect(rows[2]).toHaveTextContent('\u2605')
  })

  it('commits an edit to a reference view with Enter, keyboard only', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleView() } })
    render(<Harness api={api} />)
    await user.click(screen.getByRole('button', { name: 'Structure' }))

    const viewInput = screen.getByLabelText('Reference 0 view')
    await user.click(viewInput)
    await user.clear(viewInput)
    await user.keyboard('THHIT_ActivityDetail_v2_view{Enter}')

    await waitFor(() => expect(screen.getByLabelText('Reference 0 view')).toHaveValue('THHIT_ActivityDetail_v2_view'))
  })

  it('Escape reverts an in-progress edit without committing it', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleView() } })
    const setPropertySpy = vi.spyOn(api, 'setProperty')
    render(<Harness api={api} />)
    await user.click(screen.getByRole('button', { name: 'Structure' }))

    const entityFieldInput = screen.getByLabelText('Reference 1 entity field')
    await user.click(entityFieldInput)
    await user.clear(entityFieldInput)
    await user.keyboard('Discarded{Escape}')

    expect(screen.getByLabelText('Reference 1 entity field')).toHaveValue('#ENTITY')
    expect(setPropertySpy).not.toHaveBeenCalled()
  })

  it('shows the visual preview by default', () => {
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleView() } })
    render(<Harness api={api} />)
    expect(screen.getByLabelText('View preview')).toBeInTheDocument()
  })
})
