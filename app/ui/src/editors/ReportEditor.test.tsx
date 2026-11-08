import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportEditor } from './ReportEditor'
import type { WireValue } from '../wire/types'
import { createMockForgeApi } from '../test/mockApi'

// Mirrors Organisation_report.aod's real shape (crates/aod/tests/fixtures/DemoProject/report) - the
// real R26 (RISKS.md) array side: 4 `subreport`s and 3 `image`s project as indexed arrays.
function sampleReportArrayShape(): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: { kind: 'text', value: 'Organisation_report' } },
      { key: 'title', value: { kind: 'text', value: 'Customer Base Sheet' } },
      { key: 'description', value: { kind: 'text', value: '' } },
      { key: 'majorModelMode', value: { kind: 'text', value: 'DISTRIBUTED' } },
      { key: 'reportData', value: { kind: 'text', value: '%aditoprj%/report/Organisation_report/reportData.jrxml' } },
      { key: 'reportType', value: { kind: 'text', value: 'JASPER' } },
      {
        key: 'subReports',
        value: {
          kind: 'object',
          fields: [
            {
              key: 'subreport',
              value: {
                kind: 'array',
                items: [
                  { kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: 'Kontaktpersonen' } }, { key: 'reportData', value: { kind: 'text', value: 'Kontaktpersonen.jrxml' } }] },
                  { kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: 'Historien' } }, { key: 'reportData', value: { kind: 'text', value: 'Historien.jrxml' } }] },
                  { kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: 'Aufgaben' } }, { key: 'reportData', value: { kind: 'text', value: 'Aufgaben.jrxml' } }] },
                  { kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: 'Kommunikationsdaten' } }, { key: 'reportData', value: { kind: 'text', value: 'Kommunikationsdaten.jrxml' } }] },
                ],
              },
            },
          ],
        },
      },
      {
        key: 'images',
        value: {
          kind: 'object',
          fields: [
            {
              key: 'image',
              value: {
                kind: 'array',
                items: [
                  { kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: 'myLogo' } }, { key: 'fileName', value: { kind: 'text', value: 'myLogo.png' } }] },
                  { kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: 'icon' } }, { key: 'fileName', value: { kind: 'text', value: 'icon.png' } }] },
                  { kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: 'iconInactive' } }, { key: 'fileName', value: { kind: 'text', value: 'iconInactive.png' } }] },
                ],
              },
            },
          ],
        },
      },
    ],
  }
}

// Mirrors Salesorder_report.aod's real shape - the real R26 (RISKS.md) un-indexed side: a single
// `subreport`/`image` each project as a plain `object`, not an `array` entry, plus a real `alias`.
function sampleReportSingleOccurrences(): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: { kind: 'text', value: 'Salesorder_report' } },
      { key: 'title', value: { kind: 'text', value: 'Recipt' } },
      { key: 'description', value: { kind: 'text', value: '' } },
      { key: 'majorModelMode', value: { kind: 'text', value: 'DISTRIBUTED' } },
      { key: 'alias', value: { kind: 'text', value: 'Data_alias' } },
      { key: 'reportData', value: { kind: 'text', value: '%aditoprj%/report/Salesorder_report/reportData.jrxml' } },
      { key: 'reportType', value: { kind: 'text', value: 'JASPER' } },
      {
        key: 'subReports',
        value: { kind: 'object', fields: [{ key: 'subreport', value: { kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: 'UMST' } }, { key: 'reportData', value: { kind: 'text', value: 'UMST.jrxml' } }] } }] },
      },
      {
        key: 'images',
        value: { kind: 'object', fields: [{ key: 'image', value: { kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: 'myLogo' } }, { key: 'fileName', value: { kind: 'text', value: 'myLogo.png' } }] } }] },
      },
    ],
  }
}

// Mirrors THHIT_ResourceOperation_report.aod's real minimal shape - no `title`/`description`/
// `subReports`/`images` at all (verified: real file omits all of them), just the always-present
// `name`/`majorModelMode`/`alias`/`reportData`/`reportType`.
function sampleReportMinimal(): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: { kind: 'text', value: 'THHIT_ResourceOperation_report' } },
      { key: 'majorModelMode', value: { kind: 'text', value: 'DISTRIBUTED' } },
      { key: 'alias', value: { kind: 'text', value: 'Data_alias' } },
      { key: 'reportData', value: { kind: 'text', value: '%aditoprj%/report/THHIT_ResourceOperation_report/reportData.jrxml' } },
      { key: 'reportType', value: { kind: 'text', value: 'JASPER' } },
    ],
  }
}

function Harness({ api, tree: initial }: { api: ReturnType<typeof createMockForgeApi>; tree: WireValue }) {
  const [tree, setTree] = useState(initial)
  return <ReportEditor nodeId="node-1" projectRoot="C:/demo" tree={tree} api={api} onTreeChange={setTree} />
}

describe('ReportEditor (P4 seventh family, "Fertig"-Kriterium 3)', () => {
  it('renders the array R26 shape (4 subreports, 3 images)', () => {
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleReportArrayShape() } })
    render(<Harness api={api} tree={sampleReportArrayShape()} />)

    expect(screen.getByText('Organisation_report')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Customer Base Sheet')
    for (const subreport of ['Kontaktpersonen', 'Historien', 'Aufgaben', 'Kommunikationsdaten']) {
      expect(screen.getByText(subreport)).toBeInTheDocument()
    }
    for (const image of ['myLogo', 'icon', 'iconInactive']) {
      expect(screen.getByText(image)).toBeInTheDocument()
    }
  })

  it('renders the single-occurrence R26 shape (1 subreport, 1 image, alias)', () => {
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleReportSingleOccurrences() } })
    render(<Harness api={api} tree={sampleReportSingleOccurrences()} />)

    expect(screen.getByText('UMST')).toBeInTheDocument()
    expect(screen.getByText('myLogo')).toBeInTheDocument()
    expect(screen.getByText('Data_alias')).toBeInTheDocument()
  })

  it('hides title/description/subreports/images when the real document omits them (THHIT_ResourceOperation_report shape)', () => {
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleReportMinimal() } })
    render(<Harness api={api} tree={sampleReportMinimal()} />)

    expect(screen.getByText('THHIT_ResourceOperation_report')).toBeInTheDocument()
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument()
    expect(screen.queryByText('Subreports')).not.toBeInTheDocument()
    expect(screen.queryByText('Images')).not.toBeInTheDocument()
  })

  it('commits an edit to title with Enter, keyboard only', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleReportArrayShape() } })
    render(<Harness api={api} tree={sampleReportArrayShape()} />)

    const input = screen.getByLabelText('Title')
    await user.click(input)
    await user.clear(input)
    await user.keyboard('Edited Title{Enter}')

    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Edited Title'))
  })

  it('Escape reverts an in-progress edit to description without committing it', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleReportArrayShape() } })
    const setPropertySpy = vi.spyOn(api, 'setProperty')
    render(<Harness api={api} tree={sampleReportArrayShape()} />)

    const input = screen.getByLabelText('Description')
    const original = (input as HTMLInputElement).value
    await user.click(input)
    await user.type(input, 'discarded')
    await user.keyboard('{Escape}')

    expect(screen.getByLabelText('Description')).toHaveValue(original)
    expect(setPropertySpy).not.toHaveBeenCalled()
  })
})
