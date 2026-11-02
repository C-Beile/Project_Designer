import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Shell } from '../shell/Shell'
import { createMockForgeApi } from '../test/mockApi'
import { buildTreeMenu, diskFolderOf, objectLayout, type MenuEntry } from './contextMenu'
import type { TreeNode } from '../wire/types'

const entity = (id: string, extra: Partial<TreeNode> = {}): TreeNode => ({ id, label: 'Person', object_type: 'entity', is_leaf: true, children: [], kind: 'object', ...extra })

const find = (items: MenuEntry[], id: string) => items.find((i) => i.id === id)
const labels = (items: MenuEntry[]) => items.filter((i) => !i.separator).map((i) => i.label)

const file = (id: string, extra: Partial<TreeNode> = {}): TreeNode => ({ id, label: id.split('/').pop() ?? id, object_type: null, is_leaf: true, children: [], kind: 'file', ...extra })

describe('file menu (original shot 94)', () => {
  it('lists the entries of the original in order, with NodeJS only for package.json', () => {
    const pkg = buildTreeMenu(file('C:/p/package.json'), { clipboard: null, hasProject: true })
    expect(labels(pkg)).toEqual(['Open', 'Open As...', 'Open in System', 'Cut', 'Copy', 'Paste', 'Delete', 'Rename...', 'History', 'Git', 'NodeJS', 'Tools', 'Save As Template...', 'Properties'])
    expect(find(pkg, 'file.cut')?.shortcut).toBe('Ctrl+X')
    expect(find(pkg, 'file.copy')?.shortcut).toBe('Ctrl+C')
    expect(find(pkg, 'file.paste')?.shortcut).toBe('Ctrl+V')
    expect(find(pkg, 'nodejs')?.children?.map((c) => c.label)).toEqual(['npm install', 'npm clean-install', 'npm outdated', 'npm update', 'npm login', 'npm publish'])
    const other = buildTreeMenu(file('C:/p/README.md'), { clipboard: null, hasProject: true })
    expect(labels(other)).not.toContain('NodeJS')
  })

  it('dims the entries the original does not document, with a reason', () => {
    const items = buildTreeMenu(file('C:/p/package.json'), { clipboard: null, hasProject: true })
    for (const id of ['file.openAs', 'tools', 'file.saveTemplate']) {
      expect(find(items, id)?.enabled).toBe(false)
      expect(find(items, id)?.hint).toMatch(/not documented/)
    }
  })

  it('pastes only after a copy or cut and never changes module files', () => {
    expect(find(buildTreeMenu(file('C:/p/a.txt'), { clipboard: null, hasProject: true }), 'file.paste')?.enabled).toBe(false)
    const withClip = buildTreeMenu(file('C:/p/a.txt'), { clipboard: null, hasProject: true, fileClipboard: { path: 'C:/p/b.txt', cut: false } })
    expect(find(withClip, 'file.paste')?.enabled).toBe(true)
    const module = buildTreeMenu(file('C:/p/node_modules/@x/m/a.txt', { read_only: true }), { clipboard: null, hasProject: true, fileClipboard: { path: 'C:/p/b.txt', cut: false } })
    for (const id of ['file.cut', 'file.paste', 'file.delete', 'file.rename']) expect(find(module, id)?.enabled).toBe(false)
    expect(find(module, 'file.copy')?.enabled).toBe(true)
    expect(labels(buildTreeMenu(file('C:/p/node_modules/@x/m/package.json', { read_only: true }), { clipboard: null, hasProject: true }))).not.toContain('NodeJS')
  })

  it('a folder row offers Paste for files', () => {
    const dir: TreeNode = { id: 'dir:C:/p/others', label: 'others', object_type: null, is_leaf: false, children: [], kind: 'dir' }
    const items = buildTreeMenu(dir, { clipboard: null, hasProject: true, fileClipboard: { path: 'C:/p/b.txt', cut: true } })
    expect(find(items, 'file.paste')?.enabled).toBe(true)
  })
})

describe('buildTreeMenu', () => {
  it('offers Liquibase > Update on a database alias and keeps both drop actions off', () => {
    const alias: TreeNode = { id: 'C:/p/alias/Data_alias/Data_alias.aod', label: 'Data_alias', object_type: 'aliasDefinition', is_leaf: true, children: [], kind: 'object' }
    const items = buildTreeMenu(alias, { clipboard: null, hasProject: true })
    const lb = find(items, 'liquibase')
    expect(lb?.enabled).toBe(true)
    expect(lb?.children?.map((c) => c.label)).toEqual(['Update...', 'Drop All...', 'Drop All & Update...'])
    expect(find(lb?.children ?? [], 'liquibase.update')?.enabled).toBe(true)
    expect(find(lb?.children ?? [], 'liquibase.dropAll')?.enabled).toBe(false)
    expect(find(lb?.children ?? [], 'liquibase.dropAllUpdate')?.enabled).toBe(false)
    expect(find(buildTreeMenu(entity('C:/p/entity/Person/Person.aod'), { clipboard: null, hasProject: true }), 'liquibase')).toBeUndefined()
  })

  it('lists the entity entries of the original in order, Deploy dimmed', () => {
    const items = buildTreeMenu(entity('C:/p/entity/Person/Person.aod'), { clipboard: null, hasProject: true })
    expect(labels(items)).toEqual([
      'Open', 'Copy', 'Paste', 'Open Model Source', 'Deploy "Person"', 'Find...', 'Find Usages', 'Replace', 'Delete', 'Rename...', 'History', 'Git', 'Refresh Folder', 'Tools', 'Properties',
    ])
    expect(find(items, 'deploy')?.enabled).toBe(false)
    for (const id of ['open', 'copy', 'openSource', 'delete', 'rename', 'refresh', 'properties']) expect(find(items, id)?.enabled).toBe(true)
  })

  it('never offers Delete for module objects or foreign layouts', () => {
    const module = buildTreeMenu(entity('C:/p/node_modules/@x/m/entity/Person/Person.aod', { read_only: true }), { clipboard: null, hasProject: true })
    expect(find(module, 'delete')?.enabled).toBe(false)
    expect(find(module, 'delete')?.hint).toMatch(/read-only/)
    const odd = buildTreeMenu(entity('C:/p/entity/Person/Other.aod'), { clipboard: null, hasProject: true })
    expect(find(odd, 'delete')?.enabled).toBe(false)
    expect(find(odd, 'copy')?.enabled).toBe(false)
  })

  it('offers Create Modification only for module objects', () => {
    const module = buildTreeMenu(entity('C:/p/node_modules/@x/m/entity/Person/Person.aod', { read_only: true }), { clipboard: null, hasProject: true })
    expect(find(module, 'createModification')?.enabled).toBe(true)
    expect(find(buildTreeMenu(entity('C:/p/entity/Person/Person.aod'), { clipboard: null, hasProject: true }), 'createModification')).toBeUndefined()
  })

  it('enables Paste only for objects of the copied type', () => {
    const clip = { path: 'C:/p/entity/A/A.aod', folder: 'entity', name: 'A' }
    expect(find(buildTreeMenu(entity('C:/p/entity/B/B.aod'), { clipboard: clip, hasProject: true }), 'paste')?.enabled).toBe(true)
    expect(find(buildTreeMenu(entity('C:/p/language/B/B.aod'), { clipboard: clip, hasProject: true }), 'paste')?.enabled).toBe(false)
    const folder: TreeNode = { id: 'folder:C:/p|entity', label: 'entity', object_type: null, is_leaf: false, children: [], kind: 'folder', folder: 'entity' }
    expect(find(buildTreeMenu(folder, { clipboard: clip, hasProject: true }), 'paste')?.enabled).toBe(true)
    expect(find(buildTreeMenu(folder, { clipboard: null, hasProject: true }), 'paste')?.enabled).toBe(false)
  })

  it('gives the project root the transpile entries and the module only dimmed ones', () => {
    const project: TreeNode = { id: 'project:C:/p', label: 'p', object_type: null, is_leaf: false, children: [], kind: 'project' }
    const items = buildTreeMenu(project, { clipboard: null, hasProject: true })
    expect(labels(items)).toEqual(['Upgrade All Models', 'Upgrade JDito', 'Partial Transpile', 'Full Transpile', 'Deploy...', 'Build and Deploy...', 'Find...', 'Close', 'Rename...', 'History', 'Git', 'Refresh Folder', 'Properties'])
    expect(find(items, 'transpile.partial')?.enabled).toBe(true)
    const mod = buildTreeMenu({ ...project, kind: 'module' }, { clipboard: null, hasProject: true })
    expect(find(mod, 'transpile.partial')?.enabled).toBe(false)
  })

  it('reads the object layout from a path', () => {
    expect(objectLayout('C:\\p\\entity\\Person\\Person.aod')).toEqual({ folder: 'entity', name: 'Person' })
    expect(objectLayout('C:/p/entity/Person/Other.aod')).toBeNull()
  })
})

describe('tree context menu in the shell', () => {
  const tree: TreeNode[] = [
    {
      id: 'project:C:/p',
      label: 'p',
      object_type: null,
      is_leaf: false,
      kind: 'project',
      children: [
        {
          id: 'folder:C:/p|entity',
          label: 'entity',
          object_type: null,
          is_leaf: false,
          kind: 'folder',
          folder: 'entity',
          children: [entity('C:/p/entity/Person/Person.aod')],
        },
      ],
    },
  ]

  async function setup() {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: tree, documents: { 'C:/p/entity/Person/Person.aod': { kind: 'object', fields: [] } } })
    render(<Shell api={api} projectRoot="C:/p" />)
    const folder = await screen.findByRole('treeitem', { name: 'entity' })
    await user.click(folder)
    await user.keyboard('{ArrowRight}')
    const row = await screen.findByRole('treeitem', { name: /Person/ })
    await user.pointer({ keys: '[MouseRight]', target: row })
    return { user, api }
  }

  it('deletes only after the confirming click in the dialog', async () => {
    const { user, api } = await setup()
    const menu = screen.getByRole('menu', { name: 'Context menu' })
    expect(within(menu).getByRole('menuitem', { name: /Deploy/ })).toHaveAttribute('aria-disabled', 'true')
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
    expect(api.treeCalls).toEqual([])
    const dialog = screen.getByRole('dialog', { name: 'Delete' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.treeCalls).toEqual([])
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByRole('treeitem', { name: /Person/ }) })
    await user.click(within(screen.getByRole('menu', { name: 'Context menu' })).getByRole('menuitem', { name: 'Delete' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete' })).getByRole('button', { name: 'Delete' }))
    expect(api.treeCalls).toEqual(['delete:C:/p/entity/Person/Person.aod'])
  })

  it('copies and pastes under a new name through the name dialog', async () => {
    const { user, api } = await setup()
    await user.click(within(screen.getByRole('menu', { name: 'Context menu' })).getByRole('menuitem', { name: 'Copy' }))
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByRole('treeitem', { name: /Person/ }) })
    await user.click(within(screen.getByRole('menu', { name: 'Context menu' })).getByRole('menuitem', { name: 'Paste' }))
    const input = screen.getByRole('textbox', { name: 'New object name' })
    expect(input).toHaveValue('Person_copy')
    expect(api.treeCalls).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Paste' }))
    expect(api.treeCalls).toHaveLength(1)
    expect(api.treeCalls[0]).toMatch(/^copy:C:\/p\/entity\/Person\/Person\.aod->.*:Person_copy$/)
  })
})

describe('New and Rename entries', () => {
  const folder = (key: string): TreeNode => ({ id: `folder:${key}`, label: key, object_type: null, is_leaf: false, children: [], kind: 'folder', folder: key })

  it('offers New on type folders of an open project and picks the folder on disk', () => {
    expect(find(buildTreeMenu(folder('entity'), { clipboard: null, hasProject: true }), 'new')?.enabled).toBe(true)
    expect(find(buildTreeMenu(folder('entity'), { clipboard: null, hasProject: false }), 'new')?.enabled).toBe(false)
    expect(find(buildTreeMenu(folder('others'), { clipboard: null, hasProject: true }), 'new')?.enabled).toBe(false)
    expect(diskFolderOf('context')).toBe('neonContext')
    expect(diskFolderOf('notificationtype')).toBe('neonNotificationType')
    expect(diskFolderOf('entity')).toBe('entity')
    expect(diskFolderOf('test')).toBeNull()
  })

  it('offers Rename for entities, views and webservices of the project, never for module objects or other types', () => {
    const own = buildTreeMenu(entity('C:/p/entity/Person/Person.aod'), { clipboard: null, hasProject: true })
    expect(find(own, 'rename')?.enabled).toBe(true)
    const module = buildTreeMenu(entity('C:/p/node_modules/@x/m/entity/Person/Person.aod', { read_only: true }), { clipboard: null, hasProject: true })
    expect(find(module, 'rename')?.enabled).toBe(false)
    expect(find(module, 'rename')?.hint).toMatch(/read-only/)
    const process = buildTreeMenu(entity('C:/p/process/Lib/Lib.aod', { object_type: 'process' }), { clipboard: null, hasProject: true })
    expect(find(process, 'rename')?.enabled).toBe(false)
  })
})
