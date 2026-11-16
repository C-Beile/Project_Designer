import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../../src/config/configSchema'
import { layoutConfig, parseLayoutConfig } from '../../src/config/layoutConfig'
import { limitsConfig, parseLimitsConfig } from '../../src/config/limitsConfig'
import { applyStyleConfig, parseStyleConfig, resolveIcon, styleConfig, styleConfigCss } from '../../src/config/styleConfig'
import { defaultLayout, PANEL_IDS } from '../../src/shell/layoutState'

const configDir = resolve(__dirname, '../../../config')

describe('app/config files', () => {
  it('every key line carries a comment that lists what is allowed', () => {
    for (const file of readdirSync(configDir).filter((f) => f.endsWith('.toml'))) {
      // In style.toml erklärt ein Beispiel die Einzel-Icons ([icon.<name>]); ihre Zeilen brauchen keinen Kommentar.
      let inIcon = false
      const bare = readFileSync(resolve(configDir, file), 'utf8')
        .split(/\r?\n/)
        .filter((l) => {
          if (l.startsWith('[')) inIcon = file === 'style.toml' && l.startsWith('[icon.')
          return !inIcon && /^[A-Za-z][\w-]*\s*=/.test(l) && !/^(id|title)\s*=/.test(l) && !l.includes('#')
        })
      expect(bare, `${file}: Schlüssel ohne Kommentar`).toEqual([])
    }
  })
})

describe('layout.toml', () => {
  it('loads and matches the panels of the layout state', () => {
    expect(layoutConfig.panels.map((p) => p.id).sort()).toEqual([...PANEL_IDS].sort())
  })

  it('opens the startup panels in the default layout and leaves Output for later', () => {
    const d = defaultLayout()
    expect(d.panels).toEqual({ projects: 'open', properties: 'open', navigator: 'open', output: 'closed' })
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

describe('style.toml', () => {
  const text = readFileSync(resolve(configDir, 'style.toml'), 'utf8')

  it('has the defaults from the approved design', () => {
    expect(styleConfig.radius).toEqual({ window: 6, control: 3, tab: 4, box: 3, badge: 2 })
    expect(styleConfig.font).toEqual({ ident: 'ibm-plex-mono', code: 'ibm-plex-mono' })
    expect(styleConfig.icons.entity).toEqual({ name: 'database', color: '#f25c9c' })
    expect(styleConfig.areas.toolbar).toEqual({ style: 'fill', thickness: 'regular', color: 'text' })
  })

  it('rejects a font that is not in the list', () => {
    expect(() => parseStyleConfig(text.replace('ident = "ibm-plex-mono"', 'ident = "comic-sans"'))).toThrow(/font\.ident.*ibm-plex-mono \| jetbrains-mono/)
  })

  it('rejects an unknown key', () => {
    expect(() => parseStyleConfig(text.replace('[motion]', '[motion]\nspeed = 1'))).toThrow(/motion\.speed.*unbekannt/)
  })

  it('writes the same values as the CSS defaults, with compact rows in their own rule', () => {
    const css = styleConfigCss()
    expect(css).toContain('--radius-window:6px')
    expect(css).toContain('--row-h:1.5rem')
    expect(css).toContain(":root[data-density='compact']{--row-h:1.25rem}")
    expect(css).toContain("--font-ident:'IBM Plex Mono'")
  })

  it('resolves an icon from its own values first, then from its area', () => {
    expect(resolveIcon('run', 'toolbar')).toEqual({ name: undefined, weight: 'fill', color: 'success' })
    expect(resolveIcon('deploy', 'toolbar').color).toBe('accent-2')
    expect(resolveIcon('open', 'toolbar')).toEqual({ name: undefined, weight: 'fill', color: 'text' })
    expect(resolveIcon('entity', 'tree')).toMatchObject({ name: 'database', weight: 'fill', color: '#f25c9c' })
    expect(resolveIcon('x', 'control')).toMatchObject({ weight: 'bold', color: 'muted' })
    const changed = parseStyleConfig(text.replace('[icon.run]', '[icon.run]\nstyle = "line"\nthickness = "light"'))
    expect(resolveIcon('run', 'toolbar', changed).weight).toBe('light')
  })

  it('rejects a wrong value of a single icon', () => {
    expect(() => parseStyleConfig(text.replace('[icon.run]', '[icon.run]\nstyle = "filled"'))).toThrow(/icon\.run\.style.*line \| fill \| duotone/)
    expect(() => parseStyleConfig(text.replace(/\[icon\.run\]\r?\ncolor = "success"/, '[icon.run]\ncolor = "red"'))).toThrow(/icon\.run\.color.*Hex/)
  })

  it('sets one fixed colour per artefact type, independent of the theme', () => {
    expect(styleConfigCss()).toContain('--folder-entity:#f25c9c')
    const changed = parseStyleConfig(text.replace('color = "#f25c9c"', 'color = "#ff8800"'))
    expect(styleConfigCss(changed)).toContain('--folder-entity:#ff8800')
  })

  it('applies one style element and reuses it', () => {
    applyStyleConfig()
    applyStyleConfig()
    expect(document.querySelectorAll('#style-config')).toHaveLength(1)
  })
})
