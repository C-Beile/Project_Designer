import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DashboardEditor } from './DashboardEditor'
import type { WireValue } from '../wire/types'
import { createMockForgeApi } from '../test/mockApi'

// Mirrors Home.aod's real shape (crates/aod/tests/fixtures/DemoProject/neonDashboard), trimmed to
// two dashlets.
function sampleDashboard(): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: { kind: 'text', value: 'Home' } },
      { key: 'title', value: { kind: 'text', value: 'My Dashboard' } },
      { key: 'dashboardType', value: { kind: 'text', value: 'PRIVATE' } },
      {
        key: 'defaultDashlets',
        value: {
          kind: 'object',
          fields: [
            {
              key: 'neonDashlet',
              value: {
                kind: 'array',
                items: [
                  {
                    kind: 'object',
                    fields: [
                      { key: 'name', value: { kind: 'text', value: 'InformationDashlet' } },
                      { key: 'viewName', value: { kind: 'text', value: 'MyDashboardScoreCard_view' } },
                      { key: 'configName', value: { kind: 'text', value: 'Information' } },
                      {
                        key: 'uiConfiguration',
                        value: {
                          kind: 'object',
                          fields: [
                            { key: 'xPos', value: { kind: 'int', value: 0 } },
                            { key: 'yPos', value: { kind: 'int', value: 0 } },
                            { key: 'colspan', value: { kind: 'int', value: 1 } },
                            { key: 'rowspan', value: { kind: 'int', value: 4 } },
                          ],
                        },
                      },
                    ],
                  },
                  {
                    kind: 'object',
                    fields: [
                      { key: 'name', value: { kind: 'text', value: 'MailDropzoneDashlet' } },
                      { key: 'viewName', value: { kind: 'text', value: 'UniversalFileProcessorDropzone_view' } },
                      { key: 'configName', value: { kind: 'text', value: 'MailDropzone' } },
                      {
                        key: 'uiConfiguration',
                        value: {
                          kind: 'object',
                          fields: [
                            { key: 'xPos', value: { kind: 'int', value: 1 } },
                            { key: 'yPos', value: { kind: 'int', value: 0 } },
                          ],
                        },
                      },
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
  const [tree, setTree] = useState(sampleDashboard())
  return <DashboardEditor nodeId="node-1" projectRoot="C:/demo" tree={tree} api={api} onTreeChange={setTree} />
}

describe('DashboardEditor (Ziel 3 + "Fertig"-Kriterium 3)', () => {
  it('draws every dashlet as a box on the three-column grid with the five fields of the original', () => {
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleDashboard() } })
    render(<Harness api={api} />)

    expect(screen.getByLabelText('Dashlet 0 type')).toHaveValue('InformationDashlet')
    expect(screen.getByLabelText('Dashlet 1 view')).toHaveValue('UniversalFileProcessorDropzone_view')
    for (const label of ['Dashlet Name', 'Context Name', 'Entity Name', 'View Name', 'Config Name']) expect(screen.getAllByText(label)).toHaveLength(2)
    const boxes = document.querySelectorAll<HTMLElement>('.dashlet-box')
    expect(boxes).toHaveLength(2)
    expect(boxes[0]).toHaveAttribute('data-x', '0')
    expect(boxes[0]).toHaveAttribute('data-rowspan', '4')
    expect(boxes[0].style.gridColumn).toBe('1 / span 1')
    expect(boxes[1].style.gridColumn).toBe('2 / span 1')
  })

  it('a dashlet without rowspan is four units high and colspan never leaves the grid', () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const tree: WireValue = {
      kind: 'object',
      fields: [
        { key: 'name', value: { kind: 'text', value: 'Home' } },
        {
          key: 'defaultDashlets',
          value: {
            kind: 'object',
            fields: [
              {
                key: 'neonDashlet',
                value: {
                  kind: 'array',
                  items: [{ kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: 'Wide' } }, { key: 'uiConfiguration', value: { kind: 'object', fields: [{ key: 'xPos', value: { kind: 'int', value: 1 } }, { key: 'colspan', value: { kind: 'int', value: 3 } }] } }] }],
                },
              },
            ],
          },
        },
      ],
    }
    render(<DashboardEditor nodeId="n" projectRoot="C:/demo" tree={tree} api={api} onTreeChange={() => {}} />)
    const box = document.querySelector<HTMLElement>('.dashlet-box')!
    expect(box).toHaveAttribute('data-rowspan', '4')
    expect(box).toHaveAttribute('data-colspan', '2')
  })

  it('commits an edit to a dashlet config name with Enter, keyboard only', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleDashboard() } })
    render(<Harness api={api} />)

    const configInput = screen.getByLabelText('Dashlet 0 config name')
    await user.click(configInput)
    await user.clear(configInput)
    await user.keyboard('Information2{Enter}')

    await waitFor(() => expect(screen.getByLabelText('Dashlet 0 config name')).toHaveValue('Information2'))
  })

  it('Escape reverts an in-progress edit without committing it', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleDashboard() } })
    const setPropertySpy = vi.spyOn(api, 'setProperty')
    render(<Harness api={api} />)

    const viewInput = screen.getByLabelText('Dashlet 1 view')
    await user.click(viewInput)
    await user.clear(viewInput)
    await user.keyboard('Discarded{Escape}')

    expect(screen.getByLabelText('Dashlet 1 view')).toHaveValue('UniversalFileProcessorDropzone_view')
    expect(setPropertySpy).not.toHaveBeenCalled()
  })
})
