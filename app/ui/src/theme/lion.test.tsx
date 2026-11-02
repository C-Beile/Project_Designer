import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { THEME_LABELS, useTheme } from './useTheme'
import { buildMenus, type MenuContext } from '../shell/menuModel'

const ctx: MenuContext = {
  hasProject: false,
  projectName: null,
  hasSelection: false,
  hasUnsaved: false,
  canUndo: false,
  canRedo: false,
  recentProject: null,
  theme: 'lion',
  transpileRunning: false,
  engine: 'official',
}

let monacoTheme: typeof import('./monacoTheme')

beforeAll(async () => {
  // jsdom lacks this clipboard probe that monaco-editor reads while loading.
  ;(document as unknown as { queryCommandSupported: () => boolean }).queryCommandSupported = () => false
  monacoTheme = await import('./monacoTheme')
}, 60000)

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('theme "Lion in der City"', () => {
  it('is named as asked and can be chosen directly, and survives a restart', () => {
    expect(THEME_LABELS.lion).toBe('Lion in der City')
    const first = renderHook(() => useTheme())
    act(() => first.result.current[1]('lion'))
    expect(first.result.current[0]).toBe('lion')
    expect(document.documentElement.getAttribute('data-theme')).toBe('lion')
    expect(monacoTheme.currentForgeTheme()).toBe('lion')
    first.unmount()
    const second = renderHook(() => useTheme())
    expect(second.result.current[0]).toBe('lion')
  })

  it('still flips between dark and light without an argument and falls back to dark for unknown values', () => {
    window.localStorage.setItem('forge.theme', 'nonsense')
    const hook = renderHook(() => useTheme())
    expect(hook.result.current[0]).toBe('dark')
    act(() => hook.result.current[1]())
    expect(hook.result.current[0]).toBe('light')
  })

  it('has its own editor theme and a radio entry in View > Theme', () => {
    expect(monacoTheme.monacoThemeFor('lion')).toBe(monacoTheme.LION_DARK)
    expect(monacoTheme.monacoThemeFor('dark')).toBe(monacoTheme.NIGHT_OWL_DARK)
    const view = buildMenus(ctx).find((m) => m.label === 'Tools' || m.items.some((i) => i.id === 'view.theme'))!
    const theme = view.items.find((i) => i.id === 'view.theme')!
    expect(theme.children!.map((c) => c.label)).toEqual(['Dark (Night Owl)', 'Light', 'Lion in der City'])
    expect(theme.children!.find((c) => c.arg === 'lion')!.checked).toBe(true)
  })
})
