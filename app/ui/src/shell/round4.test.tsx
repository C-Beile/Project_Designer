import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Shell } from './Shell'
import { NewObjectDialog } from './NewObjectDialog'
import { ProjectZipDialog } from './ProjectZipDialog'
import { createMockForgeApi } from '../test/mockApi'
import { buildLibs, globalNames, modelUriFor } from '../theme/monacoJdito'
import type { TreeNode } from '../wire/types'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

type MockOptions = Partial<Parameters<typeof createMockForgeApi>[0]>
const mock = (options: MockOptions = {}) => createMockForgeApi({ projectTree: tree, documents: {}, ...options })

const entityNode: TreeNode = { id: 'C:/p/entity/Person/Person.aod', label: 'Person', object_type: 'entity', is_leaf: true, children: [], kind: 'object' }
const tree: TreeNode[] = [
  {
    id: 'project:C:/p',
    label: 'p',
    object_type: null,
    is_leaf: false,
    kind: 'project',
    children: [{ id: 'folder:C:/p|entity', label: 'entity', object_type: null, is_leaf: false, kind: 'folder', folder: 'entity', children: [entityNode] }],
  },
]

async function setup(options: MockOptions = {}) {
  const user = userEvent.setup()
  const api = mock({ documents: { [entityNode.id]: { kind: 'object', fields: [] } }, ...options })
  render(<Shell api={api} projectRoot="C:/p" />)
  const folder = await screen.findByRole('treeitem', { name: 'entity' })
  await user.click(folder)
  await user.keyboard('{ArrowRight}')
  const row = await screen.findByRole('treeitem', { name: /Person/ })
  return { user, api, row, folder }
}

describe('New object', () => {
  it('creates an object from the New entry of a type folder only after Create', async () => {
    const { user, api, folder } = await setup()
    await user.pointer({ keys: '[MouseRight]', target: folder })
    await user.click(within(screen.getByRole('menu', { name: 'Context menu' })).getByRole('menuitem', { name: 'New' }))
    const dialog = screen.getByRole('dialog', { name: 'Create New Model' })
    expect(within(dialog).getByRole('combobox', { name: 'Object type' })).toHaveAttribute('data-value', 'entity')
    const create = within(dialog).getByRole('button', { name: 'Finish' })
    expect(create).toBeDisabled()
    await user.type(within(dialog).getByRole('textbox', { name: 'Object name' }), 'Car_entity')
    expect(api.treeCalls).toEqual([])
    await user.click(create)
    expect(api.treeCalls).toEqual(['create:entity:Car_entity::'])
  })

  it('lists types that are not evidenced as disabled with their reason and asks for a title where needed', async () => {
    const api = mock()
    const user = userEvent.setup()
    render(<NewObjectDialog api={api} projectRoot="C:/p" initialFolder="role" onClose={() => {}} onCreated={() => {}} />)
    const select = await screen.findByRole('combobox', { name: 'Object type' })
    expect(select).toHaveAttribute('data-value', 'role')
    await user.click(select)
    expect(within(screen.getByRole('listbox', { name: 'Object types' })).getByRole('option', { name: /Report/ })).toHaveAttribute('aria-disabled', 'true')
    await user.click(select)
    await user.type(screen.getByRole('textbox', { name: 'Object name' }), 'R_one')
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Object title' }), 'Role one')
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(api.treeCalls).toEqual(['create:role:R_one:Role one:'])
  })

  it('shows the rule violation of the name and keeps Create off', async () => {
    const api = mock({ nameErrors: { 'entity/Taken': 'Taken already exists in entity.' } })
    const user = userEvent.setup()
    render(<NewObjectDialog api={api} projectRoot="C:/p" initialFolder="entity" onClose={() => {}} onCreated={() => {}} />)
    await user.type(await screen.findByRole('textbox', { name: 'Object name' }), 'Taken')
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()
    await user.clear(screen.getByRole('textbox', { name: 'Object name' }))
    await user.type(screen.getByRole('textbox', { name: 'Object name' }), 'bad name')
    expect(await screen.findByRole('alert')).toHaveTextContent("letters, digits")
  })
})

describe('Rename', () => {
  it('shows the preview first and renames only through Do Refactoring', async () => {
    const { user, api, row } = await setup({
      renamePlan: {
        object: 'Person',
        new_name: 'Human',
        object_type: 'entity',
        changes: [{ node_id: 'C:/p/neonContext/Ctx/Ctx.aod', object: 'Ctx', object_type: 'neonContext', kind: 'NeonContextEntity', line: 3 }],
        hits: [{ file: 'C:/p/process/lib/process.js', line: 4, text: 'var e = "Person"' }],
      },
    })
    await user.pointer({ keys: '[MouseRight]', target: row })
    await user.click(within(screen.getByRole('menu', { name: 'Context menu' })).getByRole('menuitem', { name: 'Rename...' }))
    const dialog = screen.getByRole('dialog', { name: 'Rename' })
    const input = within(dialog).getByRole('textbox', { name: 'New name' })
    expect(within(dialog).getByRole('button', { name: 'Preview' })).toBeDisabled()
    await user.clear(input)
    await user.type(input, 'Human')
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }))
    expect(api.treeCalls).toEqual(['renamePlan:C:/p/entity/Person/Person.aod->Human'])
    expect(await screen.findByRole('table', { name: 'Usages' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Mentions not updated' })).toHaveTextContent('var e = "Person"')
    await user.click(screen.getByRole('button', { name: 'Do Refactoring' }))
    expect(api.treeCalls).toEqual(['renamePlan:C:/p/entity/Person/Person.aod->Human', 'rename:C:/p/entity/Person/Person.aod->Human'])
  })

  it('is dimmed for module objects', async () => {
    const moduleNode: TreeNode = { ...entityNode, id: 'C:/p/node_modules/@x/m/entity/Person/Person.aod', read_only: true }
    const user = userEvent.setup()
    const api = createMockForgeApi({
      projectTree: [{ ...tree[0], children: [{ ...(tree[0].children[0] as TreeNode), children: [moduleNode] }] }],
      documents: { [moduleNode.id]: { kind: 'object', fields: [] } },
    })
    render(<Shell api={api} projectRoot="C:/p" />)
    await user.click(await screen.findByRole('treeitem', { name: 'entity' }))
    await user.keyboard('{ArrowRight}')
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByRole('treeitem', { name: /Person/ }) })
    expect(within(screen.getByRole('menu', { name: 'Context menu' })).getByRole('menuitem', { name: 'Rename...' })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('Export and Import Project', () => {
  const models = [
    { folder: 'entity', name: 'A_entity', files: 3, modified_secs: 0, exists: false },
    { folder: 'neonView', name: 'B_view', files: 1, modified_secs: 0, exists: false },
  ]

  it('exports only the ticked models to the chosen file', async () => {
    const api = mock({ projectModels: models })
    const user = userEvent.setup()
    let message = ''
    render(<ProjectZipDialog api={api} projectRoot="C:/p" mode="export" onClose={() => {}} onDone={(m) => (message = m)} />)
    await user.click(await screen.findByRole('tab', { name: /neonView/ }))
    await user.click(screen.getByRole('checkbox', { name: 'neonView/B_view' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(api.treeCalls).toEqual(['export:entity/A_entity->C:\\out\\export.zip'])
    expect(message).toContain('Exported 1 data model')
  })

  it('offers Overwrite only for models that exist and passes the choice on', async () => {
    const api = mock({
      pickedFiles: ['C:/in/p.zip'],
      zipModels: [
        { folder: 'entity', name: 'A_entity', files: 3, modified_secs: 0, exists: true },
        { folder: 'neonView', name: 'B_view', files: 1, modified_secs: 0, exists: false },
      ],
    })
    const user = userEvent.setup()
    render(<ProjectZipDialog api={api} projectRoot="C:/p" mode="import" onClose={() => {}} onDone={() => {}} />)
    expect(await screen.findByRole('checkbox', { name: 'entity/A_entity' })).toBeChecked()
    await user.click(screen.getByRole('tab', { name: /neonView/ }))
    expect(screen.queryByRole('checkbox', { name: 'Overwrite neonView/B_view' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: /entity/ }))
    await user.click(screen.getByRole('checkbox', { name: 'Overwrite entity/A_entity' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(api.treeCalls).toEqual(['import:C:/in/p.zip:entity/A_entity,neonView/B_view:entity/A_entity'])
  })

  it('is reachable from the File menu of an open project', async () => {
    const { user } = await setup({ projectModels: models })
    await user.click(screen.getByRole('menuitem', { name: 'File' }))
    await user.click(screen.getByRole('menuitem', { name: 'Export Project...' }))
    expect(await screen.findByRole('dialog', { name: 'Export Project' })).toBeInTheDocument()
  })
})

describe('JDito types for the code editor', () => {
  const files = [
    { path: 'index.d.ts', content: 'export * from "./dist/definition_vars";' },
    { path: 'dist/definition_vars.ts', content: 'interface vars {}\nexport const vars: vars = null;\nexport const BadgeType: BadgeType = null;' },
    { path: 'dist/definition_neon.ts', content: 'export const neon: neon = null;' },
  ]

  it('finds the lower-case globals of the package', () => {
    expect(globalNames(files)).toEqual(['neon', 'vars'])
  })

  it('places the package under node_modules and declares the globals', () => {
    const libs = buildLibs({ version: '2024.2.0', files })
    const paths = libs.map((l) => l.filePath)
    expect(paths).toContain('file:///node_modules/@aditosoftware/jdito-types/index.d.ts')
    expect(paths).toContain('file:///node_modules/@aditosoftware/jdito-types/dist/definition_vars.ts')
    const globals = libs.find((l) => l.filePath === 'file:///jdito-globals.d.ts')!
    expect(globals.content).toContain('declare const vars: typeof import("@aditosoftware/jdito-types").vars;')
    expect(globals.content).not.toContain('BadgeType')
  })

  it('addresses code files below a project folder', () => {
    expect(modelUriFor('C:\\p\\entity\\A\\valueProcess.js')).toBe('file:///project/p/entity/A/valueProcess.js')
  })
})
