import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextEditor } from './ContextEditor'
import type { WireValue } from '../wire/types'
import { createMockForgeApi } from '../test/mockApi'

// Mirrors THHIT_Tour.aod's real shape (crates/aod/tests/fixtures/DemoProject/neonContext).
function sampleContext(): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: { kind: 'text', value: 'THHIT_Tour' } },
      { key: 'title', value: { kind: 'text', value: 'Tour' } },
      { key: 'filterView', value: { kind: 'text', value: 'THHIT_TourFilter_view' } },
      { key: 'editView', value: { kind: 'text', value: 'THHIT_TourEdit_view' } },
      { key: 'previewView', value: { kind: 'text', value: 'THHIT_TourPreview_view' } },
      { key: 'entity', value: { kind: 'text', value: 'THHIT_Tour_entity' } },
      {
        key: 'references',
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
                      { key: 'name', value: { kind: 'text', value: '71053690-a4aa-405a-a58b-fc80ad5c8362' } },
                      { key: 'view', value: { kind: 'text', value: 'THHIT_TourFilter_view' } },
                    ],
                  },
                ],
              },
            },
            {
              key: 'webserviceReference',
              value: {
                kind: 'array',
                items: [
                  {
                    kind: 'object',
                    fields: [
                      { key: 'name', value: { kind: 'text', value: '0e23c9b9-188a-4495-84c5-48a0e26e4570' } },
                      { key: 'webservice', value: { kind: 'text', value: 'THHIT_Tour_ws' } },
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
  const [tree, setTree] = useState(sampleContext())
  return <ContextEditor nodeId="node-1" projectRoot="C:/demo" tree={tree} api={api} onTreeChange={setTree} />
}

describe('ContextEditor (Ziel 2 + "Fertig"-Kriterium 3)', () => {
  it('renders the context name and its primary view/entity slots', () => {
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleContext() } })
    render(<Harness api={api} />)

    expect(screen.getByText('THHIT_Tour')).toBeInTheDocument()
    expect(screen.getByLabelText('Context entity')).toHaveValue('THHIT_Tour_entity')
    expect(screen.getByLabelText('Context filter view')).toHaveValue('THHIT_TourFilter_view')
    expect(screen.getByLabelText('View reference 0 view')).toHaveValue('THHIT_TourFilter_view')
    expect(screen.getByLabelText('Webservice reference 0 webservice')).toHaveValue('THHIT_Tour_ws')
  })

  it('commits an edit to the entity field with Enter, keyboard only', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleContext() } })
    render(<Harness api={api} />)

    const entityInput = screen.getByLabelText('Context entity')
    await user.click(entityInput)
    await user.clear(entityInput)
    await user.keyboard('THHIT_Tour2_entity{Enter}')

    await waitFor(() => expect(screen.getByLabelText('Context entity')).toHaveValue('THHIT_Tour2_entity'))
  })

  it('Escape reverts an in-progress edit to a primary view slot without committing it', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleContext() } })
    const setPropertySpy = vi.spyOn(api, 'setProperty')
    render(<Harness api={api} />)

    const editViewInput = screen.getByLabelText('Context edit view')
    await user.click(editViewInput)
    await user.clear(editViewInput)
    await user.keyboard('Discarded{Escape}')

    expect(screen.getByLabelText('Context edit view')).toHaveValue('THHIT_TourEdit_view')
    expect(setPropertySpy).not.toHaveBeenCalled()
  })
})
