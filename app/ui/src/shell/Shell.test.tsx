import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Shell } from './Shell'
import { createMockForgeApi } from '../test/mockApi'
import { LAYOUT_STORAGE_KEY, defaultLayout, loadLayout, sanitizeLayout } from './layoutState'
import { buildMenus, shortcutItems, type MenuContext } from './menuModel'
import type { TreeNode } from '../wire/types'

function treeWithSystems(): TreeNode[] {
  return [
    {
      id: 'folder:system',
      label: 'system',
      object_type: null,
      is_leaf: false,
      children: [
        { id: 's1', label: 'default', object_type: 'system', is_leaf: true, children: [] },
        { id: 's2', label: 'dev1_bg', object_type: 'system', is_leaf: true, children: [] },
      ],
    },
  ]
}

const ctx: MenuContext = {
  hasProject: false,
  projectName: null,
  hasSelection: false,
  hasUnsaved: false,
  canUndo: false,
  canRedo: false,
  recentProject: null,
  theme: 'dark',
  transpileRunning: false,
  engine: 'official',
}

async function openMenuItem(user: ReturnType<typeof userEvent.setup>, menu: string, entry: RegExp) {
  await user.click(screen.getByRole('menuitem', { name: menu }))
  const list = screen.getByRole('menu', { name: menu })
  await user.click(within(list).getByRole('menuitem', { name: entry }))
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('menu model', () => {
  it('has all ten menus of the original in the original order', () => {
    expect(buildMenus(ctx).map((m) => m.label)).toEqual([
      'File',
      'Edit',
      'View',
      'Navigate',
      'Source',
      'Refactor',
      'Team',
      'Tools',
      'Window',
      'Help',
    ])
  })

  it('keeps the original shortcuts: Save is Ctrl+Shift+S, Save All is Ctrl+S', () => {
    const file = buildMenus(ctx)[0].items
    expect(file.find((i) => i.id === 'file.save')?.shortcut).toBe('Mod+Shift+S')
    expect(file.find((i) => i.id === 'file.saveAll')?.shortcut).toBe('Mod+S')
  })

  it('dims unavailable entries with a hint instead of hiding them, and never binds their shortcuts', () => {
    const menus = buildMenus(ctx)
    const move = menus[5].items.find((i) => i.id === 'refactor.move')!
    expect(move.enabled).toBe(false)
    expect(move.hint).toBe('Not available yet')
    expect(shortcutItems(menus).some((i) => i.id === 'refactor.move')).toBe(false)
  })

  it('enables File > New, Import/Export Project and Rename only when they can run', () => {
    const find = (menus: ReturnType<typeof buildMenus>, id: string) => {
      const walk = (items: ReturnType<typeof buildMenus>[number]['items']): ReturnType<typeof buildMenus>[number]['items'][number] | undefined => {
        for (const i of items) {
          if (i.id === id) return i
          const hit = i.children ? walk(i.children) : undefined
          if (hit) return hit
        }
        return undefined
      }
      for (const m of menus) {
        const hit = walk(m.items)
        if (hit) return hit
      }
      return undefined
    }
    const closed = buildMenus({ ...ctx, hasProject: false, usageTarget: false })
    for (const id of ['file.new', 'file.importProject', 'file.exportProject', 'refactor.rename']) expect(find(closed, id)?.enabled, id).toBe(false)
    const open = buildMenus({ ...ctx, hasProject: true, usageTarget: true })
    for (const id of ['file.new', 'file.importProject', 'file.exportProject', 'refactor.rename']) expect(find(open, id)?.enabled, id).toBe(true)
  })

  it('places the Forge transpile block before Plugins and offers Reset Windows', () => {
    const menus = buildMenus(ctx)
    const tools = menus[7].items.map((i) => i.label)
    expect(tools.indexOf('Native Tools')).toBeLessThan(tools.indexOf('Transpile (Partial)'))
    expect(tools.indexOf('Transpile (Partial)')).toBeLessThan(tools.indexOf('Plugins'))
    expect(tools.slice(-1)).toEqual(['Options'])
    expect(tools).toEqual(expect.arrayContaining(['Project Properties', 'Build and Deploy...', 'Transpile (Full)', 'Transpiler', 'Export Project Structure', 'Theme']))
    expect(menus[8].items.map((i) => i.label)).toContain('Reset Windows')
    expect(menus[9].items.map((i) => i.label)).toContain('About Vendira Designer')
  })
})

describe('layout persistence', () => {
  it('falls back to the default layout when the stored value is damaged', () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, '{broken')
    expect(loadLayout()).toEqual(defaultLayout())
  })

  it('falls back to the default layout when storage itself is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadLayout()).toEqual(defaultLayout())
    spy.mockRestore()
  })

  it('keeps valid fields, clamps sizes and ignores unknown panel modes', () => {
    const l = sanitizeLayout({ leftWidth: 99999, panels: { navigator: 'closed', output: 'weird' } })
    expect(l.leftWidth).toBe(900)
    expect(l.panels.navigator).toBe('closed')
    expect(l.panels.output).toBe('open')
  })

  it('a closed panel stays closed after a restart', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const first = render(<Shell api={api} projectRoot="" />)
    await user.click(screen.getByRole('button', { name: 'Close Navigator' }))
    first.unmount()
    render(<Shell api={api} projectRoot="" />)
    expect(screen.queryByRole('region', { name: 'Navigator' })).toBeNull()
  })
})

describe('Shell - docking', () => {
  it('shows every tool window of the original at start', () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<Shell api={api} projectRoot="" />)
    expect(screen.getByRole('tab', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Services' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Properties' })).toHaveTextContent('<No Properties>')
    expect(screen.getByRole('region', { name: 'Navigator' })).toBeInTheDocument()
    for (const t of [/^Output/, 'Search Results', 'Notifications', 'Refactoring', 'Problems']) {
      expect(screen.getByRole('tab', { name: t })).toBeInTheDocument()
    }
    for (const t of ['Database', 'Build', 'Default', 'NodeJS']) {
      expect(screen.getByRole('tab', { name: t })).toBeInTheDocument()
    }
    expect(screen.getByRole('tab', { name: /^Output/ })).toHaveTextContent('Output - Build')
  })

  it('a closed panel comes back through the Window menu, and Reset Windows restores everything', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<Shell api={api} projectRoot="" />)

    await user.click(screen.getByRole('button', { name: 'Close Navigator' }))
    expect(screen.queryByRole('region', { name: 'Navigator' })).toBeNull()
    await openMenuItem(user, 'Window', /^Navigator/)
    expect(screen.getByRole('region', { name: 'Navigator' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Minimize Output' }))
    await user.click(screen.getByRole('button', { name: 'Close Properties' }))
    expect(screen.getByRole('button', { name: 'Output' })).toBeInTheDocument()
    await openMenuItem(user, 'Window', /Reset Windows/)
    expect(screen.getByRole('region', { name: 'Properties' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Build' })).toBeInTheDocument()
  })

  it('dividers move with the keyboard', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<Shell api={api} projectRoot="" />)
    const splitter = screen.getByRole('separator', { name: 'Resize left column' })
    const before = Number(splitter.getAttribute('aria-valuenow'))
    splitter.focus()
    await user.keyboard('{ArrowRight}')
    expect(Number(splitter.getAttribute('aria-valuenow'))).toBe(before + 10)
  })
})

describe('Shell - menu keyboard', () => {
  it('F10 opens File, arrows switch menus, Escape closes', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<Shell api={api} projectRoot="" />)
    await user.keyboard('{F10}')
    expect(screen.getByRole('menu', { name: 'File' })).toBeInTheDocument()
    // File > New is a submenu, so Right on it would open that; move to the next entry first.
    await user.keyboard('{ArrowDown}{ArrowRight}')
    expect(screen.getByRole('menu', { name: 'Edit' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Enter runs the focused entry (File > Open Project…)', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, pickedFolder: null })
    const pick = vi.spyOn(api, 'pickProjectFolder')
    render(<Shell api={api} projectRoot="" />)
    await user.keyboard('{F10}')
    for (let i = 0; i < 8 && !/^Open Project/.test(document.activeElement?.textContent ?? ''); i++) await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveTextContent(/^Open Project/)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(pick).toHaveBeenCalled())
  })
})

describe('Shell - toolbar, transpile and options', () => {
  it('enables Deploy for an open project and keeps Run dimmed', async () => {
    const api = createMockForgeApi({ projectTree: treeWithSystems(), documents: {} })
    render(<Shell api={api} projectRoot="C:/demo" />)
    const deploy = screen.getByRole('button', { name: 'Deploy Project' })
    expect(deploy).not.toHaveAttribute('aria-disabled')
    expect(deploy).toHaveAttribute('title', expect.stringMatching(/^Deploy Project \(.*F8\)$/))
    expect(screen.getByRole('button', { name: 'Execute selected configuration' })).toHaveAttribute('aria-disabled', 'true')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Run configuration' })).toHaveValue('default'))
  })

  it('transpiles with the official engine, locks the button meanwhile and logs the result in Output - Build', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    let finish!: () => void
    const exec = vi.spyOn(api, 'executeAction').mockImplementation(() => new Promise<void>((r) => (finish = r)))
    render(<Shell api={api} projectRoot="C:/demo" />)

    await user.click(screen.getByRole('button', { name: 'Transpile' }))
    expect(exec).toHaveBeenCalledWith('transpile', 'C:/demo', { engine: 'official', mode: 'full' })
    expect(screen.getByRole('button', { name: 'Transpile' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('progressbar', { name: /^Transpiling \(/ })).toBeInTheDocument()

    await act(async () => finish())
    expect(await screen.findByText(/BUILD SUCCESS/)).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('Tools > Transpiler > Experimental shows the 57.25 % warning and is used for the next run', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const exec = vi.spyOn(api, 'executeAction').mockRejectedValue(new Error('engine exploded'))
    render(<Shell api={api} projectRoot="C:/demo" />)

    await user.click(screen.getByRole('menuitem', { name: 'Tools' }))
    await user.hover(screen.getByRole('menuitem', { name: /Transpiler/ }))
    await user.click(screen.getByRole('menuitemradio', { name: /Experimental/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('57.25%')

    await user.click(screen.getByRole('menuitem', { name: 'Tools' }))
    await user.click(screen.getByRole('menuitem', { name: /Transpile \(Partial\)/ }))
    expect(exec).toHaveBeenCalledWith('transpile', 'C:/demo', { engine: 'experimental', mode: 'partial' })
    expect(await screen.findByText(/BUILD FAILED: engine exploded/)).toBeInTheDocument()
  })

  it('a fresh start is always back on the official engine', () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<Shell api={api} projectRoot="" />)
    expect(screen.getByRole('combobox', { name: 'Transpiler engine' })).toHaveValue('official')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('Tools > Options shows the detected installation, saves a chosen one and transpile hands it on', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, detectedInstall: 'C:/Program Files/ADITOdesigner_2025' })
    const setSettings = vi.spyOn(api, 'setSettings')
    const exec = vi.spyOn(api, 'executeAction').mockResolvedValue(undefined)
    render(<Shell api={api} projectRoot="C:/demo" />)

    await openMenuItem(user, 'Tools', /^Options/)
    const dialog = screen.getByRole('dialog', { name: 'Options' })
    expect(await within(dialog).findByText(/Found automatically: C:\/Program Files\/ADITOdesigner_2025/)).toBeInTheDocument()
    const field = within(dialog).getByLabelText(/ADITO Designer installation/)
    await user.clear(field)
    await user.type(field, 'D:/ADITO/designer')
    await user.click(within(dialog).getByRole('button', { name: 'OK' }))

    expect(setSettings).toHaveBeenCalledWith({ designer_install_dir: 'D:/ADITO/designer', ssh_key_path: null })
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Transpile' }))
    expect(exec).toHaveBeenCalledWith('transpile', 'C:/demo', { engine: 'official', mode: 'full', install_dir: 'D:/ADITO/designer' })
  })

  it('shows the Git branch and the selected system in the status bar', async () => {
    const api = createMockForgeApi({ projectTree: treeWithSystems(), documents: {}, branch: 'feature/layout' })
    render(<Shell api={api} projectRoot="C:/demo" />)
    const status = screen.getByRole('contentinfo', { name: 'Status bar' })
    await waitFor(() => expect(status).toHaveTextContent('feature/layout'))
    expect(status).toHaveTextContent('default')
    expect(status).toHaveTextContent('N/A')
  })

  it('Help > About opens a dialog with the version line', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<Shell api={api} projectRoot="" />)
    await openMenuItem(user, 'Help', /About Vendira Designer/)
    const dialog = screen.getByRole('dialog', { name: 'About Vendira Designer' })
    expect(dialog).toHaveTextContent(/Version/)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

function projectRoot(name: string): TreeNode[] {
  return [
    {
      id: `project:C:/r/${name}`,
      label: name,
      object_type: null,
      kind: 'project',
      bold: true,
      type_label: 'ADITO xRM',
      path: `C:/r/${name}`,
      is_leaf: false,
      children: [
        {
          id: `folder:C:/r/${name}|system`,
          label: 'system',
          object_type: null,
          kind: 'folder',
          folder: 'system',
          is_leaf: false,
          children: [
            { id: `C:/r/${name}/system/dev1/dev1.aod`, label: `${name}_dev1`, object_type: 'system', kind: 'object', is_leaf: true, children: [] },
            { id: `C:/r/${name}/system/qs_bg/qs_bg.aod`, label: `${name}_qs_bg`, object_type: 'system', kind: 'object', bold: true, is_leaf: true, children: [] },
          ],
        },
      ],
    },
  ]
}

describe('Projects - several projects at once (LAYOUT_SPEC §4.2/§4.5)', () => {
  function setup(openProjects: string[], pickedFolder: string | null = null) {
    const api = createMockForgeApi({
      projectTree: [],
      projectTrees: { 'C:/r/Pichler': projectRoot('Pichler'), 'C:/r/Hermes': projectRoot('Hermes'), 'C:/r/BHB': projectRoot('BHB') },
      documents: {},
      openProjects,
      pickedFolder,
    })
    return api
  }

  function rootLabels() {
    return screen
      .getAllByRole('treeitem')
      .filter((r) => r.getAttribute('aria-level') === '1')
      .map((r) => r.querySelector('.project-tree-label')!.textContent)
  }

  function rootRow(name: string) {
    return screen.getAllByRole('treeitem').find((r) => r.getAttribute('aria-level') === '1' && r.querySelector('.project-tree-label')!.textContent === name)!
  }

  it('restores the stored projects and Open Project adds another root without duplicates', async () => {
    const user = userEvent.setup()
    const api = setup(['C:/r/Pichler'], 'C:/r/Hermes')
    const add = vi.spyOn(api, 'addOpenProject')
    render(<Shell api={api} projectRoot="" />)
    await waitFor(() => expect(rootLabels()).toEqual(['Pichler']))

    await openMenuItem(user, 'File', /^Open Project/)
    await waitFor(() => expect(rootLabels()).toEqual(['Pichler', 'Hermes']))
    expect(add).toHaveBeenCalledWith('C:/r/Hermes')

    await openMenuItem(user, 'File', /^Open Project/)
    await waitFor(() => expect(rootLabels()).toEqual(['Pichler', 'Hermes']))
  })

  it('a click makes the project active: bottom bar, Properties title and Close Project follow it', async () => {
    const user = userEvent.setup()
    const api = setup(['C:/r/Pichler', 'C:/r/Hermes'])
    const remove = vi.spyOn(api, 'removeOpenProject')
    render(<Shell api={api} projectRoot="" />)
    await waitFor(() => expect(rootLabels()).toEqual(['Pichler', 'Hermes']))
    const bar = screen.getByLabelText('Active project')
    expect(within(bar).getByText('Pichler')).toBeInTheDocument()

    await user.click(rootRow('Hermes'))
    expect(within(bar).getByText('Hermes')).toBeInTheDocument()
    expect(screen.getAllByText('Hermes - Properties').length).toBeGreaterThan(0)

    await openMenuItem(user, 'File', /^Close Project$/)
    await waitFor(() => expect(rootLabels()).toEqual(['Pichler']))
    expect(remove).toHaveBeenCalledWith('C:/r/Hermes')
  })

  it('the default system preselects the run configuration', async () => {
    render(<Shell api={setup(['C:/r/Pichler'])} projectRoot="" />)
    await waitFor(() => expect(rootLabels()).toEqual(['Pichler']))
    expect(screen.getByRole('combobox', { name: /run configuration/i })).toHaveValue('Pichler_qs_bg')
  })

  it('Close Other Projects keeps the active one, Close All Projects empties the tree', async () => {
    const user = userEvent.setup()
    render(<Shell api={setup(['C:/r/Pichler', 'C:/r/Hermes', 'C:/r/BHB'])} projectRoot="" />)
    await waitFor(() => expect(rootLabels()).toEqual(['Pichler', 'Hermes', 'BHB']))
    await user.click(rootRow('BHB'))
    await openMenuItem(user, 'File', /^Close Other Projects/)
    await waitFor(() => expect(rootLabels()).toEqual(['BHB']))
    await openMenuItem(user, 'File', /^Close All Projects/)
    await waitFor(() => expect(screen.queryAllByRole('treeitem')).toHaveLength(0))
    expect(screen.queryByLabelText('Active project')).toBeNull()
  })

  it('the X in the active-project bar closes that project', async () => {
    const user = userEvent.setup()
    render(<Shell api={setup(['C:/r/Pichler', 'C:/r/Hermes'])} projectRoot="" />)
    await waitFor(() => expect(rootLabels()).toEqual(['Pichler', 'Hermes']))
    await user.click(screen.getByRole('button', { name: 'Close project Pichler' }))
    await waitFor(() => expect(rootLabels()).toEqual(['Hermes']))
  })
})
