import { beforeEach, describe, expect, it } from 'vitest'
import { getOptions, resetOptionsForTests } from './options'
import { clampFont, clampZoom, stepEditorFont, stepUiZoom, loadUiZoom, zoomKeyAction } from './zoom'

const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...extra })

describe('zoom', () => {
  beforeEach(() => {
    resetOptionsForTests()
    window.localStorage.clear()
  })

  it('maps Ctrl plus/minus/0 to the editor and Ctrl+Shift to the whole interface', () => {
    expect(zoomKeyAction(key('+'))).toEqual({ target: 'editor', step: 1 })
    expect(zoomKeyAction(key('-'))).toEqual({ target: 'editor', step: -1 })
    expect(zoomKeyAction(key('0'))).toEqual({ target: 'editor', step: null })
    expect(zoomKeyAction(key('+', { shiftKey: true }))).toEqual({ target: 'ui', step: 1 })
    expect(zoomKeyAction(key('-', { shiftKey: true }))).toEqual({ target: 'ui', step: -1 })
    expect(zoomKeyAction(key('+', { ctrlKey: false }))).toBeNull()
    expect(zoomKeyAction(key('a'))).toBeNull()
  })

  it('changes the editor font size within its limits and keeps it in the options', () => {
    expect(stepEditorFont(1)).toBe(14)
    expect(getOptions().editor.fontSize).toBe(14)
    expect(stepEditorFont(-100)).toBe(clampFont(-100))
    expect(stepEditorFont(null)).toBe(13)
  })

  it('changes the interface zoom in steps of 10 percent within its limits', () => {
    expect(stepUiZoom(1)).toBe(1.1)
    expect(loadUiZoom()).toBe(1.1)
    expect(stepUiZoom(-100)).toBe(clampZoom(-100))
    expect(stepUiZoom(null)).toBe(1)
  })
})
