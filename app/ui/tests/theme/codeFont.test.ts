import { describe, expect, it } from 'vitest'
import { codeFontStack, whenFontReady } from '../../src/theme/codeFont'

describe('codeFont', () => {
  it('uses the default font of style.toml when nothing is chosen', () => {
    expect(codeFontStack('')).toMatch(/^'IBM Plex Mono'/)
    expect(codeFontStack('   ')).toMatch(/^'IBM Plex Mono'/)
  })

  it('puts a chosen font first and keeps a fallback behind it', () => {
    expect(codeFontStack('Fira Code')).toBe("Fira Code, 'Cascadia Mono', Consolas, monospace")
  })

  it('does not wait for fonts where the browser has no font loading', async () => {
    await expect(whenFontReady("'IBM Plex Mono', monospace")).resolves.toBeUndefined()
  })
})
