import { afterEach, describe, expect, it } from 'vitest'
import { collectTokens, groupTokens, isColorValue, previewTheme, restoreTheme, snapshotTheme } from '../../../../src/core/ui/gallery/themePreview'

afterEach(() => {
  document.head.querySelectorAll('style[data-test]').forEach((s) => s.remove())
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-theme')
})

function addStyle(css: string) {
  const style = document.createElement('style')
  style.setAttribute('data-test', '')
  style.textContent = css
  document.head.appendChild(style)
}

describe('collectTokens', () => {
  it('finds variables on :root and on theme blocks once each, in order', () => {
    addStyle(":root { --bg: #000; --fg: #fff; --space-1: 0.25rem; } :root[data-theme='lion'] { --bg: #222; --icon-entity: #abc; } .other { --not-root: 1; }")
    expect(collectTokens().map((t) => t.name)).toEqual(['--bg', '--fg', '--space-1', '--icon-entity'])
  })

  it('groups by prefix and puts unknown prefixes under Other', () => {
    addStyle(':root { --bg: #000; --fg: #fff; --space-1: 1px; --folder-system: red; --mystery: 1; }')
    const groups = Object.fromEntries(groupTokens(collectTokens()))
    expect(groups.Surfaces).toEqual(['--bg'])
    expect(groups.Text).toEqual(['--fg'])
    expect(groups.Scales).toEqual(['--space-1'])
    expect(groups['Folder colours']).toEqual(['--folder-system'])
    expect(groups.Other).toEqual(['--mystery'])
  })
})

describe('isColorValue', () => {
  it('recognises colours and gradients but not sizes', () => {
    expect(['#fff', 'rgb(0 0 0 / 0.5)', 'color-mix(in srgb, red 10%, blue)', 'linear-gradient(red, blue)'].every(isColorValue)).toBe(true)
    expect(['0.25rem', '12', 'cubic-bezier(0, 0, 1, 1)'].some(isColorValue)).toBe(false)
  })
})

describe('theme preview', () => {
  it('previews Lion with its TOML colours and restores the snapshot', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    document.documentElement.style.setProperty('--font-ui', 'Inter')
    const before = snapshotTheme()
    previewTheme('lion')
    expect(document.documentElement.getAttribute('data-theme')).toBe('lion')
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#4aa8e8')
    restoreTheme(before)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--font-ui')).toBe('Inter')
  })
})
