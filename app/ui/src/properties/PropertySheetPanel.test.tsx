import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PropertySheetPanel } from './PropertySheetPanel'
import { createMockForgeApi } from '../test/mockApi'
import { DialogHost } from '../core/dialogService'
import type { PropertySheet, WireValue } from '../wire/types'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

const text = (value: string): WireValue => ({ kind: 'text', value })
const doc: WireValue = { kind: 'object', fields: [{ key: 'name', value: text('Thing_entity') }, { key: 'title', value: text('Old') }] }

function sheetOf(readOnly: boolean): PropertySheet {
  return {
    name: 'Thing_entity',
    type_label: 'entity',
    path: '$',
    catalog_missing: false,
    read_only: readOnly ? 'Objects of modules under node_modules are read-only.' : undefined,
    groups: [
      {
        key: 'g',
        label: '',
        rows: [
          { name: 'title', kind: 'text', value: text('Old'), display: 'Old', set: true, editable: !readOnly, typed: false, would_edit: true },
          { name: 'onInit', kind: 'linked', display: '', set: false, editable: false, typed: false, would_edit: true, new_reference: '%aditoprj%/entity/Thing_entity/onInit.js' },
        ],
      },
    ],
  }
}

function setup(readOnly: boolean) {
  const nodeId = readOnly ? 'C:/p/node_modules/@s/m/entity/Thing_entity/Thing_entity.aod' : 'C:/p/entity/Thing_entity/Thing_entity.aod'
  const api = createMockForgeApi({ projectTree: [], documents: { [nodeId]: doc } })
  api.getPropertySheet = async () => sheetOf(readOnly)
  const onEdited = vi.fn()
  const onStatus = vi.fn()
  const onOpenCode = vi.fn()
  render(
    <>
    <DialogHost />
    <PropertySheetPanel
      api={api}
      target={{ nodeId, path: '$' }}
      linkedRoot="C:/p"
      projectRoot="C:/proj"
      version={0}
      referenceOptions={() => []}
      onGoTo={() => {}}
      onEdited={onEdited}
      onStatus={onStatus}
      onOpenCode={onOpenCode}
    />
    </>,
  )
  return { api, nodeId, onEdited, onStatus, onOpenCode }
}

describe('Properties panel editing', () => {
  it('clearing a set value removes the property again', async () => {
    const user = userEvent.setup()
    const { api, nodeId, onEdited } = setup(false)
    const input = await screen.findByRole('textbox', { name: 'title' })
    await user.clear(input)
    await user.tab()
    await waitFor(() => expect(onEdited).toHaveBeenCalled())
    const sheetTree = await api.getPropertyTree(nodeId)
    expect(sheetTree.kind === 'object' && sheetTree.fields.some((f) => f.key === 'title')).toBe(false)
  })

  it('the ... button opens an unset code property as an editor tab, a single click only selects', async () => {
    const user = userEvent.setup()
    const { onOpenCode } = setup(false)
    const open = await screen.findByRole('button', { name: 'Open onInit' })
    expect(open).toBeEnabled()
    await user.click(screen.getByText('onInit'))
    expect(onOpenCode).not.toHaveBeenCalled()
    await user.click(open)
    expect(onOpenCode).toHaveBeenCalledWith(
      { ownerNodeId: 'C:/p/entity/Thing_entity/Thing_entity.aod', ownerName: 'Thing_entity', path: '$', prop: 'onInit', reference: '%aditoprj%/entity/Thing_entity/onInit.js', linkedRoot: 'C:/p', isNew: true },
      false,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a double click on the code value opens the tab too', async () => {
    const user = userEvent.setup()
    const { onOpenCode } = setup(false)
    const open = await screen.findByRole('button', { name: 'Open onInit' })
    await user.dblClick(open.parentElement!)
    expect(onOpenCode).toHaveBeenCalledTimes(1)
  })

  it('the context menu offers Set to Default only for a set property', async () => {
    const user = userEvent.setup()
    const { api, nodeId, onEdited } = setup(false)
    await screen.findByRole('textbox', { name: 'title' })
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('onInit') })
    const unset = await screen.findByRole('menuitem', { name: 'Set to Default' })
    expect(unset).toHaveAttribute('aria-disabled', 'true')
    expect(unset).toHaveAttribute('title', expect.stringMatching(/not set/))
    await user.keyboard('{Escape}')
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('title') })
    await user.click(await screen.findByRole('menuitem', { name: 'Set to Default' }))
    await waitFor(() => expect(onEdited).toHaveBeenCalled())
    const tree = await api.getPropertyTree(nodeId)
    expect(tree.kind === 'object' && tree.fields.some((f) => f.key === 'title')).toBe(false)
  })

  it('Set to Default on a module object deletes the modification after asking', async () => {
    const user = userEvent.setup()
    const { api, nodeId, onStatus } = setup(true)
    await screen.findByRole('textbox', { name: 'title' })
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('title') })
    await user.click(await screen.findByRole('menuitem', { name: 'Set to Default' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith(expect.stringMatching(/Modification mod-1 deleted/)))
    expect(api.enabledModifications).toEqual([nodeId])
  })

  it('editing a module object creates the modification automatically and announces it without a dialog', async () => {
    const user = userEvent.setup()
    const { api, nodeId } = setup(true)
    const input = await screen.findByRole('textbox', { name: 'title' })
    expect(input).not.toHaveAttribute('readonly')
    await user.clear(input)
    await user.type(input, 'New')
    await user.tab()
    await waitFor(() => expect(api.enabledModifications).toEqual([nodeId]))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('declining the delete question of Set to Default keeps the modification', async () => {
    const user = userEvent.setup()
    const { api } = setup(true)
    await screen.findByRole('textbox', { name: 'title' })
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('title') })
    await user.click(await screen.findByRole('menuitem', { name: 'Set to Default' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(api.enabledModifications).toEqual([])
  })
})
