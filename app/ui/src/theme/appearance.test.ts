import { describe, expect, it } from 'vitest'
import { applyAppearance, clampFontSize, rootPixelSize } from './appearance'

describe('appearance', () => {
  it('keeps the root at 16px for the default size and scales proportionally', () => {
    expect(rootPixelSize(12)).toBe(16)
    expect(rootPixelSize(15)).toBe(20)
    expect(rootPixelSize(9)).toBe(12)
  })

  it('clamps the font size to 10..18 and falls back to 12 for junk', () => {
    expect(clampFontSize(4)).toBe(10)
    expect(clampFontSize(40)).toBe(18)
    expect(clampFontSize('x')).toBe(12)
    expect(clampFontSize(13.4)).toBe(13)
  })

  it('writes size, family and density onto the root element', () => {
    const el = document.createElement('html')
    applyAppearance({ fontSize: 14, fontFamily: 'Inter', density: 'compact' }, el)
    expect(el.style.fontSize).toBe('18.666666666666668px')
    expect(el.style.getPropertyValue('--font-ui')).toBe('Inter')
    expect(el.getAttribute('data-density')).toBe('compact')
    applyAppearance({ fontSize: 12, fontFamily: '', density: 'normal' }, el)
    expect(el.style.getPropertyValue('--font-ui')).toBe('')
    expect(el.hasAttribute('data-density')).toBe(false)
  })
})
