import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AliasDbEditor } from './AliasDbEditor'
import type { WireValue } from '../wire/types'
import { createMockForgeApi } from '../test/mockApi'

// Mirrors THHIT_System_alias.aod's real shape (app/core/tests/fixtures/DemoProject/aliasDefinition) -
// a small, single-table-free DB alias.
function sampleDbAlias(): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: { kind: 'text', value: 'THHIT_Data_alias' } },
      { key: 'datasourceType', value: { kind: 'int', value: 0 } },
      {
        key: 'aliasDefinitionSub',
        value: {
          kind: 'object',
          fields: [
            {
              key: 'aliasDefDb',
              value: {
                kind: 'object',
                fields: [
                  { key: 'targetAliasName', value: { kind: 'text', value: 'Data_alias' } },
                  {
                    key: 'entityGroup',
                    value: {
                      kind: 'object',
                      fields: [
                        {
                          key: 'entities',
                          value: {
                            kind: 'object',
                            fields: [
                              {
                                key: 'entityDb',
                                value: {
                                  kind: 'array',
                                  items: [
                                    {
                                      kind: 'object',
                                      fields: [
                                        { key: 'name', value: { kind: 'text', value: 'THHIT_AUDIT' } },
                                        { key: 'idColumn', value: { kind: 'text', value: 'AUDITID' } },
                                        {
                                          key: 'entityFields',
                                          value: {
                                            kind: 'object',
                                            fields: [
                                              {
                                                key: 'entityFieldDb',
                                                value: {
                                                  kind: 'array',
                                                  items: [
                                                    {
                                                      kind: 'object',
                                                      fields: [
                                                        { key: 'name', value: { kind: 'text', value: 'AUDITID' } },
                                                        { key: 'dbName', value: { kind: 'text', value: '' } },
                                                        { key: 'columnType', value: { kind: 'int', value: 12 } },
                                                        { key: 'size', value: { kind: 'int', value: 36 } },
                                                        { key: 'primaryKey', value: { kind: 'bool', value: true } },
                                                        { key: 'notNull', value: { kind: 'bool', value: true } },
                                                      ],
                                                    },
                                                  ],
                                                },
                                              },
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

// Mirrors Hermes' IndexSearch.aod shape: a non-DB alias with no aliasDefinitionSub at all.
function sampleNonDbAlias(): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: { kind: 'text', value: 'IndexSearch' } },
      { key: 'datasourceType', value: { kind: 'int', value: 18 } },
    ],
  }
}

function Harness({ api, tree: initial }: { api: ReturnType<typeof createMockForgeApi>; tree: WireValue }) {
  const [tree, setTree] = useState(initial)
  return <AliasDbEditor nodeId="node-1" projectRoot="C:/demo" tree={tree} api={api} onTreeChange={setTree} />
}

describe('AliasDbEditor (Ziel 1 + "Fertig"-Kriterium 3)', () => {
  it('renders the alias name, target alias name, and its table/column model', () => {
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleDbAlias() } })
    render(<Harness api={api} tree={sampleDbAlias()} />)

    expect(screen.getByText('THHIT_Data_alias')).toBeInTheDocument()
    expect(screen.getByLabelText('Alias target alias name')).toHaveValue('Data_alias')
    expect(screen.getByText('THHIT_AUDIT')).toBeInTheDocument()
    expect(screen.getByLabelText('Table 0 id column')).toHaveValue('AUDITID')
    expect(screen.getByText('AUDITID')).toBeInTheDocument()
    expect(screen.getAllByText('yes')).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'primary key' })).toBeInTheDocument()
    expect(screen.queryByText(/intentionally not implemented|typed-scalar/)).toBeNull()
  })

  it('commits an edit to targetAliasName with Enter, keyboard only', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleDbAlias() } })
    render(<Harness api={api} tree={sampleDbAlias()} />)

    const input = screen.getByLabelText('Alias target alias name')
    await user.click(input)
    await user.clear(input)
    await user.keyboard('Data_alias_renamed{Enter}')

    await waitFor(() => expect(screen.getByLabelText('Alias target alias name')).toHaveValue('Data_alias_renamed'))
  })

  it('Escape reverts an in-progress edit to a column db name without committing it', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleDbAlias() } })
    const setPropertySpy = vi.spyOn(api, 'setProperty')
    render(<Harness api={api} tree={sampleDbAlias()} />)

    const dbNameInput = screen.getByLabelText('Table 0 column 0 db name')
    await user.click(dbNameInput)
    await user.type(dbNameInput, 'Discarded')
    await user.keyboard('{Escape}')

    expect(screen.getByLabelText('Table 0 column 0 db name')).toHaveValue('')
    expect(setPropertySpy).not.toHaveBeenCalled()
  })

  it('renders a non-DB alias (no aliasDefDb) gracefully, without a table', () => {
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleNonDbAlias() } })
    render(<Harness api={api} tree={sampleNonDbAlias()} />)

    expect(screen.getByText('IndexSearch')).toBeInTheDocument()
    expect(screen.getByText(/Datasource type: 18/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Alias target alias name')).not.toBeInTheDocument()
  })
})

describe('sqlTypeName', () => {
  it('names the java.sql.Types codes seen in the real alias files and keeps unknown codes', async () => {
    const { sqlTypeName } = await import('./AliasDbEditor')
    expect([12, 4, 93, 91, 1].map(sqlTypeName)).toEqual(['VARCHAR', 'INTEGER', 'TIMESTAMP', 'DATE', 'CHAR'])
    expect(sqlTypeName(9999)).toBe('9999')
    expect(sqlTypeName(undefined)).toBe('')
  })
})

describe('AliasDbEditor cards', () => {
  it('collapses a card, filters tables and columns and shows the badge', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': sampleDbAlias() } })
    render(<Harness api={api} tree={sampleDbAlias()} />)
    expect(screen.getByText(/\d+ columns?/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Collapse THHIT_AUDIT' }))
    expect(screen.queryByRole('table')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Expand THHIT_AUDIT' }))
    expect(screen.getByRole('table')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Filter tables and columns'), 'nomatchxyz')
    expect(screen.queryByRole('table')).toBeNull()
    await user.clear(screen.getByLabelText('Filter tables and columns'))
    await user.type(screen.getByLabelText('Filter tables and columns'), 'AUDITID')
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
