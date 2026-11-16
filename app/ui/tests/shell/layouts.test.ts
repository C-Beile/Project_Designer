import { afterEach, describe, expect, it } from 'vitest'
import { _resetAppConfigForTests } from '../../src/settings/appConfig'
import { defaultLayout } from '../../src/shell/layoutState'
import { deleteNamedLayout, LAYOUT_PRESETS, listSavedLayouts, loadNamedLayout, saveNamedLayout } from '../../src/shell/layouts'

afterEach(() => _resetAppConfigForTests())

describe('layouts', () => {
  it('presets rebuild the grid and Editor Focus keeps only Projects', () => {
    const focus = LAYOUT_PRESETS.find((p) => p.id === 'editor-focus')!.build()
    expect(focus.reset).toBeTypeOf('number')
    expect(Object.values(focus.panels).filter((m) => m === 'open')).toHaveLength(1)
    expect(LAYOUT_PRESETS.find((p) => p.id === 'default')!.build().panels).toEqual(defaultLayout().panels)
  })

  it('saves, lists, loads and deletes a named layout', () => {
    expect(listSavedLayouts()).toEqual([])
    saveNamedLayout('Wide', { ...defaultLayout(), panels: { ...defaultLayout().panels, output: 'closed' }, dock: { grid: {} } })
    expect(listSavedLayouts()).toEqual(['Wide'])
    const loaded = loadNamedLayout('Wide')!
    expect(loaded.panels.output).toBe('closed')
    expect(loaded.reset).toBeTypeOf('number')
    deleteNamedLayout('Wide')
    expect(listSavedLayouts()).toEqual([])
    expect(loadNamedLayout('Wide')).toBeUndefined()
  })
})
