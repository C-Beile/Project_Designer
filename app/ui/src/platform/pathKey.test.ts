import { afterEach, describe, expect, it, vi } from 'vitest'
import { pathKey } from './pathKey'

describe('pathKey', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('unifies separators and drops a trailing slash', () => {
    expect(pathKey('C:\\Repos\\Pichler\\')).toBe(pathKey('C:/Repos/Pichler'))
  })

  it('ignores letter case on Windows', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' })
    expect(pathKey('C:/Repos/Pichler')).toBe(pathKey('c:/repos/pichler'))
  })

  it('keeps letter case on macOS, where two folders can differ only by case', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    expect(pathKey('/Users/a/Project')).not.toBe(pathKey('/Users/a/project'))
    expect(pathKey('/Users/a/Project/')).toBe('/Users/a/Project')
  })
})
