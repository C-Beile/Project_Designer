import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildMenus, type MenuContext, type MenuItemDef } from './menuModel'
import { TOOLBAR_GROUPS } from './toolbarPrefs'

// Compares the main menu and the toolbar groups with the runtime reading of the original (designer_gui/runtime.json).
const RUNTIME = resolve(__dirname, '../../../../../../60_design/designer_gui/runtime.json')
const haveSpec = existsSync(RUNTIME)

interface RuntimeEntry {
  role: string
  name: string
}
interface RuntimeMenu {
  name: string
  children: RuntimeEntry[]
}

const ctx: MenuContext = {
  hasProject: true,
  projectName: 'p',
  hasSelection: true,
  hasUnsaved: false,
  canUndo: false,
  canRedo: false,
  recentProject: null,
  theme: 'dark',
  transpileRunning: false,
  engine: 'official',
}

// Entries of the original that Vendira shows one level deeper (or not at all) on purpose; see ORIGINAL_DELTA.md.
const MOVED: Record<string, string[]> = {
  Tools: ['Re-fresh Native Tools', 'View Native Tools Status', 'Open Native Tools Directory'],
  Help: ['About NetBeans', 'About ADITO'],
}

const norm = (s: string) => s.replace(/\.{3}$/, '').trim().toLowerCase()
const names = (items: MenuItemDef[]) => items.filter((i) => i.kind !== 'separator').map((i) => norm(i.label))

describe.skipIf(!haveSpec)('menu bar against runtime.json', () => {
  const runtime = JSON.parse(readFileSync(RUNTIME, 'utf8')) as { menubar: RuntimeMenu[]; toolbars: { group: string; buttons: { name: string }[] }[] }
  const menus = buildMenus(ctx)

  it('has the menus of the original in the same order', () => {
    expect(menus.map((m) => m.label)).toEqual(runtime.menubar.filter((m) => m.name).map((m) => m.name))
  })

  for (const rm of runtime.menubar.filter((m) => m.name)) {
    it(`${rm.name}: every named entry is present in the original order`, () => {
      const menu = menus.find((m) => m.label === rm.name)!
      const ours = names(menu.items)
      const moved = (MOVED[rm.name] ?? []).map(norm)
      const wanted = rm.children.filter((c) => c.role !== 'separator' && c.name).map((c) => norm(c.name)).filter((n) => !moved.includes(n))
      const missing = wanted.filter((n) => !ours.includes(n))
      expect(missing, `missing in ${rm.name}`).toEqual([])
      expect(ours.filter((n) => wanted.includes(n))).toEqual(wanted)
    })
  }

  it('separators fall between the same entries in the File menu', () => {
    const file = menus[0].items
    const rt = runtime.menubar[0].children
    const groups = (xs: { sep: boolean; label: string }[]) => {
      const out: string[][] = [[]]
      for (const x of xs) {
        if (x.sep) out.push([])
        else out[out.length - 1].push(norm(x.label))
      }
      return out
    }
    const a = groups(file.map((i) => ({ sep: i.kind === 'separator', label: i.label })))
    const b = groups(rt.map((c) => ({ sep: c.role === 'separator', label: c.name })))
    expect(a).toEqual(b)
  })

  it('keeps the toolbar groups in the original order', () => {
    const ours = TOOLBAR_GROUPS.map((g) => g.label.toLowerCase())
    const order = runtime.toolbars.map((t) => t.group.toLowerCase())
    expect(ours.filter((g) => order.includes(g)).sort((x, y) => order.indexOf(x) - order.indexOf(y))).toEqual(ours.filter((g) => order.includes(g)).sort((x, y) => order.indexOf(x) - order.indexOf(y)))
    expect(order).toEqual(['open', 'undoredo', 'deploy', 'run', 'git', 'analytics', 'convert'])
  })
})

describe('shortcuts of the original (menus.json)', () => {
  const menus = buildMenus(ctx)
  const find = (id: string) => menus.flatMap((m) => m.items.flatMap((i) => [i, ...(i.children ?? [])])).find((i) => i.id === id)

  it('binds Redo to Ctrl+Y and Find to Ctrl+O', () => {
    expect(find('edit.redo')?.shortcut).toBe('Mod+Y')
    expect(find('file.find')?.shortcut).toBe('Mod+O')
    expect(find('file.new')?.shortcut).toBe('Mod+N')
    expect(find('file.save')?.shortcut).toBe('Mod+Shift+S')
    expect(find('file.saveAll')?.shortcut).toBe('Mod+S')
    expect(find('view.onlyEditor')?.shortcut).toBe('Mod+Shift+Enter')
  })

  it('leaves Paste from History without a shortcut and keeps the Edit order', () => {
    expect(find('edit.pasteFromHistory')?.shortcut).toBeUndefined()
    const edit = names(menus[1].items)
    expect(edit.slice(0, 11)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'paste formatted', 'paste from history', 'paste as lines', 'delete', 'select all', 'select identifier'])
  })
})
