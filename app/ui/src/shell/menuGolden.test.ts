import { describe, expect, it } from 'vitest'
import { buildMenus, type MenuContext, type MenuDef, type MenuItemDef } from './menuModel'

const base: MenuContext = {
  devBuild: false,
  hasProject: true,
  projectName: 'p',
  projectCount: 1,
  hasSelection: true,
  hasUnsaved: false,
  canUndo: true,
  canRedo: false,
  recentProject: 'C:/p',
  theme: 'lion',
  transpileRunning: false,
  engine: 'official',
  hasCodeEditor: true,
  usageTarget: true,
  gitActive: true,
  gitRepo: true,
  gitChanges: true,
}

const contexts: Record<string, MenuContext> = {
  'project open': base,
  'no project': { ...base, hasProject: false, projectName: null, projectCount: 0, hasSelection: false, canUndo: false, hasCodeEditor: false, usageTarget: false },
  'unsaved changes with redo': { ...base, hasUnsaved: true, canRedo: true },
  'transpile running': { ...base, transpileRunning: true },
  'dev build': { ...base, devBuild: true },
  'git off': { ...base, gitActive: false, gitRepo: false, gitChanges: false },
  'git without repo': { ...base, gitRepo: false, gitChanges: false },
}

function lines(items: MenuItemDef[], depth: number): string[] {
  return items.flatMap((i) => {
    if (i.kind === 'separator') return [`${'  '.repeat(depth)}---`]
    const flags = [i.enabled ? '' : 'disabled', i.checked ? 'checked' : '', i.shortcut ? `[${i.shortcut}]` : '', i.hint ? `hint: ${i.hint}` : '']
    const head = `${'  '.repeat(depth)}${i.id} | ${i.label} ${flags.filter(Boolean).join(' ')}`.trimEnd()
    return [head, ...lines(i.children ?? [], depth + 1)]
  })
}

function describeMenus(menus: MenuDef[]): string {
  return menus.map((m) => [`# ${m.id} (${m.label}, ${m.mnemonic})`, ...lines(m.items, 1)].join('\n')).join('\n\n') + '\n'
}

describe('main menu (golden)', () => {
  for (const [name, ctx] of Object.entries(contexts)) {
    it(name, async () => {
      await expect(describeMenus(buildMenus(ctx))).toMatchFileSnapshot(`./__golden__/menu-${name.replace(/ /g, '-')}.txt`)
    })
  }
})
