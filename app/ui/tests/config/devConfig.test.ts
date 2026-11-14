import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../../src/config/configSchema'
import { layoutConfig, parseLayoutConfig } from '../../src/config/layoutConfig'
import { limitsConfig, parseLimitsConfig } from '../../src/config/limitsConfig'
import { defaultLayout, PANEL_IDS } from '../../src/shell/layoutState'

const configDir = resolve(__dirname, '../../../config')

describe('app/config files', () => {
  it('every key line carries a comment that lists what is allowed', () => {
    for (const file of readdirSync(configDir).filter((f) => f.endsWith('.toml'))) {
      const bare = readFileSync(resolve(configDir, file), 'utf8')
        .split(/\r?\n/)
        .filter((l) => /^[A-Za-z][\w-]*\s*=/.test(l) && !/^(id|title)\s*=/.test(l) && !l.includes('#'))
      expect(bare, `${file}: Schlüssel ohne Kommentar`).toEqual([])
    }
  })
})

describe('layout.toml', () => {
  it('loads and matches the panels of the layout state', () => {
    expect(layoutConfig.panels.map((p) => p.id).sort()).toEqual([...PANEL_IDS].sort())
  })

  it('opens all startup panels in the default layout', () => {
    const d = defaultLayout()
    expect(Object.values(d.panels)).toEqual(['open', 'open', 'open', 'open'])
  })

  const base = '[behavior]\nreopen = "default"\n[panel.a]\ntitle = "A"\narea = "left"\ngroup = "g"\nopens = "startup"\nclosable = true\n'

  it('names file, key and allowed values when something is wrong', () => {
    expect(() => parseLayoutConfig(base.replace('"left"', '"middle"'))).toThrow(/layout\.toml: panel\.a\.area.*"middle".*top-left \| top/)
    expect(() => parseLayoutConfig(base.replace('"startup"', '"later"'))).toThrow(/opens.*startup \| on-demand/)
    expect(() => parseLayoutConfig(base + 'colour = "red"\n')).toThrow(/colour.*unbekannt/)
    expect(() => parseLayoutConfig(base.replace('[panel.a]', '[panel.A_b]'))).toThrow(/Panel-Id/)
    expect(() => parseLayoutConfig(base.replace('closable = true\n', ''))).toThrow(/closable fehlt/)
    expect(() => parseLayoutConfig('[behavior]\nreopen = "default"\n[area.nowhere]\nwidth = 1\n' + base.slice(base.indexOf('[panel.a]')))).toThrow(ConfigError)
  })

  it('lets a panel override the size by writing width or height', () => {
    expect(parseLayoutConfig(base + 'height = 320\n').panels[0].height).toBe(320)
    expect(parseLayoutConfig(base).panels[0].height).toBeUndefined()
  })
})

describe('limits.toml', () => {
  it('allows at most 3 popup windows', () => {
    expect(limitsConfig.windows.maxPopups).toBe(3)
  })

  it('rejects values out of range', () => {
    expect(() => parseLimitsConfig('[windows]\nmax-popups = 0\nmax-editor-windows = 3\n')).toThrow(/max-popups.*1 bis 10/)
  })
})
