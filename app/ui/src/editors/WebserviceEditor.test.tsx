import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WebserviceEditor } from './WebserviceEditor'
import type { WireValue } from '../wire/types'
import { createMockForgeApi } from '../test/mockApi'

// Mirrors THHIT_Tour_ws.aod's real shape (app/core/tests/fixtures/DemoProject/entityWebservice) -
// the real R26 (RISKS.md) shape: a single `webserviceMethods`/`loginTypeId` element projects
// un-indexed (plain `text`, not `array`), and its single `webserviceFieldConsumer` projects as an
// `object`, not an array entry, with its own nested `webserviceFields`.
function sampleWebserviceSingleOccurrences(): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: { kind: 'text', value: 'THHIT_Tour_ws' } },
      { key: 'majorModelMode', value: { kind: 'text', value: 'DISTRIBUTED' } },
      { key: 'webserviceMethods', value: { kind: 'object', fields: [{ key: 'element', value: { kind: 'text', value: 'GET' } }] } },
      { key: 'loginTypeId', value: { kind: 'object', fields: [{ key: 'element', value: { kind: 'text', value: 'VendiraToken' } }] } },
      { key: 'jditoWebserviceUser', value: { kind: 'text', value: '' } },
      { key: 'writeProvider', value: { kind: 'text', value: '' } },
      { key: 'readProvider', value: { kind: 'text', value: '' } },
      {
        key: 'webserviceFields',
        value: {
          kind: 'object',
          fields: [
            {
              key: 'webserviceField',
              value: {
                kind: 'array',
                items: [
                  { kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: 'u1' } }, { key: 'webserviceFieldName', value: { kind: 'text', value: 'TOURID' } }] },
                  { kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: 'u2' } }, { key: 'webserviceFieldName', value: { kind: 'text', value: 'COUNTRY' } }] },
                ],
              },
            },
            {
              key: 'webserviceFieldConsumer',
              value: {
                kind: 'object',
                fields: [
                  { key: 'name', value: { kind: 'text', value: 'cu1' } },
                  { key: 'consumer', value: { kind: 'text', value: 'Documents' } },
                  {
                    key: 'webserviceFields',
                    value: {
                      kind: 'object',
                      fields: [
                        {
                          key: 'webserviceField',
                          value: { kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: 'u3' } }, { key: 'webserviceFieldName', value: { kind: 'text', value: 'UID' } }] },
                        },
                      ],
                    },
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

// Mirrors Operation_ws.aod's real shape - a 5-element `webserviceMethods` array (the R26 array
// side), no `loginTypeId` at all, and no `jditoWebserviceUser`/`writeProvider`/`readProvider` gap
// (all three present here, absent in the `THHIT_PersonUpdate_ws`-shaped test below).
function sampleWebserviceMultiMethods(): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: { kind: 'text', value: 'Operation_ws' } },
      { key: 'majorModelMode', value: { kind: 'text', value: 'DISTRIBUTED' } },
      {
        key: 'webserviceMethods',
        value: { kind: 'object', fields: [{ key: 'element', value: { kind: 'array', items: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => ({ kind: 'text', value: m })) } }] },
      },
      { key: 'jditoWebserviceUser', value: { kind: 'text', value: 'wsServiceUser' } },
      { key: 'writeProvider', value: { kind: 'text', value: '#PROVIDER' } },
      { key: 'readProvider', value: { kind: 'text', value: '#PROVIDER' } },
      {
        key: 'webserviceFields',
        value: {
          kind: 'object',
          fields: [
            {
              key: 'webserviceField',
              value: { kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: 'u1' } }, { key: 'webserviceFieldName', value: { kind: 'text', value: 'STATUS' } }] },
            },
          ],
        },
      },
    ],
  }
}

// Mirrors THHIT_PersonUpdate_ws.aod's real minimal shape - no `jditoWebserviceUser`/
// `writeProvider`/`readProvider` at all (verified: real file omits all three), a single, un-indexed
// `webserviceField` (the clearest real R26 minimal case found this round).
function sampleWebserviceMinimal(): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: { kind: 'text', value: 'THHIT_PersonUpdate_ws' } },
      { key: 'majorModelMode', value: { kind: 'text', value: 'DISTRIBUTED' } },
      { key: 'webserviceMethods', value: { kind: 'object', fields: [{ key: 'element', value: { kind: 'text', value: 'PATCH' } }] } },
      {
        key: 'webserviceFields',
        value: {
          kind: 'object',
          fields: [
            {
              key: 'webserviceField',
              value: { kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: 'u1' } }, { key: 'webserviceFieldName', value: { kind: 'text', value: 'THHIT_NAVCONTACTNR' } }] },
            },
          ],
        },
      },
    ],
  }
}

function Harness({ api, tree: initial }: { api: ReturnType<typeof createMockForgeApi>; tree: WireValue }) {
  const [tree, setTree] = useState(initial)
  return <WebserviceEditor nodeId="node-1" projectRoot="C:/demo" tree={tree} api={api} onTreeChange={setTree} />
}

describe('WebserviceEditor (P4 sixth family, "Fertig"-Kriterium 3)', () => {
  it('renders the single-occurrence R26 shape (methods, login types, consumer) correctly', () => {
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleWebserviceSingleOccurrences() } })
    render(<Harness api={api} tree={sampleWebserviceSingleOccurrences()} />)

    expect(screen.getByText('THHIT_Tour_ws')).toBeInTheDocument()
    expect(screen.getByText('GET')).toBeInTheDocument()
    expect(screen.getByText('VendiraToken')).toBeInTheDocument()
    expect(screen.getByText('TOURID')).toBeInTheDocument()
    expect(screen.getByText('COUNTRY')).toBeInTheDocument()
    expect(screen.getByText('Documents')).toBeInTheDocument()
    expect(screen.getByText('UID')).toBeInTheDocument()
  })

  it('renders the multi-method R26 array shape', () => {
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleWebserviceMultiMethods() } })
    render(<Harness api={api} tree={sampleWebserviceMultiMethods()} />)

    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      expect(screen.getByText(method)).toBeInTheDocument()
    }
    expect(screen.getByLabelText('Write provider')).toHaveValue('#PROVIDER')
  })

  it('hides the optional provider fields when the real document omits them (THHIT_PersonUpdate_ws shape)', () => {
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleWebserviceMinimal() } })
    render(<Harness api={api} tree={sampleWebserviceMinimal()} />)

    expect(screen.getByText('THHIT_NAVCONTACTNR')).toBeInTheDocument()
    expect(screen.queryByLabelText('JDito webservice user')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Write provider')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Read provider')).not.toBeInTheDocument()
  })

  it('commits an edit to readProvider with Enter, keyboard only', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleWebserviceMultiMethods() } })
    render(<Harness api={api} tree={sampleWebserviceMultiMethods()} />)

    const input = screen.getByLabelText('Read provider')
    await user.click(input)
    await user.clear(input)
    await user.keyboard('#EDITED{Enter}')

    await waitFor(() => expect(screen.getByLabelText('Read provider')).toHaveValue('#EDITED'))
  })

  it('Escape reverts an in-progress edit to writeProvider without committing it', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleWebserviceMultiMethods() } })
    const setPropertySpy = vi.spyOn(api, 'setProperty')
    render(<Harness api={api} tree={sampleWebserviceMultiMethods()} />)

    const input = screen.getByLabelText('Write provider')
    const original = (input as HTMLInputElement).value
    await user.click(input)
    await user.type(input, 'discarded')
    await user.keyboard('{Escape}')

    expect(screen.getByLabelText('Write provider')).toHaveValue(original)
    expect(setPropertySpy).not.toHaveBeenCalled()
  })
})
