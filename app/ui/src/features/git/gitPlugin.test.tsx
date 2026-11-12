import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { _resetPluginRegistryForTests } from '../../core/plugins/registry'
import { buildMenus, type MenuContext } from '../../shell/menuModel'
import { OptionsDialog } from '../../shell/OptionsDialog'
import { createMockForgeApi } from '../../test/mockApi'
import { registerGitPlugin } from './gitPlugin'

const ctx: MenuContext = {
  hasProject: true,
  projectName: 'p',
  hasSelection: false,
  hasUnsaved: false,
  canUndo: false,
  canRedo: false,
  recentProject: null,
  theme: 'dark',
  transpileRunning: false,
  engine: 'adito' as MenuContext['engine'],
}
const team = (c: MenuContext) => buildMenus(c).find((m) => m.id === 'team')!.items

beforeEach(() => _resetPluginRegistryForTests())

describe('Git plugin in the UI registry', () => {
  it('has no Git menu entries without the plugin', () => {
    expect(team(ctx).map((i) => i.id)).toEqual(['team.shelve'])
  })

  it('adds Git and History to Team when registered, and removes them again', () => {
    const off = registerGitPlugin()
    const ids = team(ctx).map((i) => i.id)
    expect(ids).toEqual(['team.shelve', 'team.sep.git', 'team.git', 'team.sep.history', 'team.historyMenu'])
    expect(team(ctx).find((i) => i.id === 'team.git')!.children!.map((c) => c.label)).toEqual(['Repository...', 'Sign In...', '', 'Commit...', 'Pull...', 'Push...', 'Switch Branch...'])
    off()
    expect(team(ctx).map((i) => i.id)).toEqual(['team.shelve'])
  })

  it('keeps the dimmed state and hint of the Plugins dialog switch', () => {
    registerGitPlugin()
    const git = team({ ...ctx, gitActive: false }).find((i) => i.id === 'team.git')!
    expect(git.enabled).toBe(false)
    expect(git.hint).toBe('The Git plugin is deactivated (Tools > Plugins)')
    expect(team({ ...ctx, hasProject: false }).find((i) => i.id === 'team.git')!.hint).toBe('Open a project first')
  })

  it('shows the Team options category only with the plugin', async () => {
    const props = { api: createMockForgeApi({ projectTree: [], documents: {} }), onClose: () => {}, onSaved: () => {}, engine: 'adito' as MenuContext['engine'], onEngineChange: () => {}, theme: 'dark' as const, onThemeChange: () => {}, keymap: [] }
    const { unmount } = render(<OptionsDialog {...props} />)
    expect(screen.queryByRole('tab', { name: 'Git' })).toBeNull()
    unmount()
    registerGitPlugin()
    render(<OptionsDialog {...props} />)
    expect(screen.getByRole('tab', { name: 'Git' })).toBeInTheDocument()
  })
})
