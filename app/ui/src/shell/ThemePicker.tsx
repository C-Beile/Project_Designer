import { useMemo, useState } from 'react'
import type { ImportedTheme } from '../theme/vscodeTheme'

// Theme choice of Options > Appearance as a gallery: every theme is a card with a small picture of the window in its
// colours, so a theme can be picked by looking at it. The built-in themes come first, then the installed VS Code themes.

export interface ThemePreview {
  /** Editor background, side bar, title bar, accent and the colours of five kinds of code. */
  background: string
  sideBar: string
  titleBar: string
  accent: string
  code: [string, string, string, string, string]
}

export interface ThemeCard {
  id: string
  name: string
  kind: 'dark' | 'light'
  /** Where the theme comes from. */
  source: 'built-in' | 'VS Code'
  preview: ThemePreview
}

/** The picture of a built-in theme (its colours as in tokens.css). */
export const BUILTIN_THEME_CARDS: ThemeCard[] = [
  { id: 'dark', name: 'Dark (Night Owl)', kind: 'dark', source: 'built-in', preview: { background: '#011627', sideBar: '#0b2942', titleBar: '#010e1a', accent: '#82aaff', code: ['#c792ea', '#ecc48d', '#82aaff', '#637777', '#f78c6c'] } },
  { id: 'light', name: 'Light', kind: 'light', source: 'built-in', preview: { background: '#fbfbfb', sideBar: '#f0f0f0', titleBar: '#e4e4e4', accent: '#4070d4', code: ['#994cc3', '#4876d6', '#4070d4', '#989fb1', '#aa0982'] } },
  { id: 'lion', name: 'Lion in der City', kind: 'dark', source: 'built-in', preview: { background: '#2b2b2b', sideBar: '#353535', titleBar: '#1f1f1f', accent: '#4aa8e8', code: ['#b48fd8', '#e0b46a', '#4aa8e8', '#8a8a8a', '#5cc8c0'] } },
]

/** The card of an imported VS Code theme, with the colours the theme itself defines. */
export function cardOfImported(theme: ImportedTheme): ThemeCard {
  const c = theme.data.colors
  const rule = (token: string) => {
    const hit = theme.data.rules.find((r) => r.token === token && r.foreground)
    return hit?.foreground ? `#${hit.foreground}` : undefined
  }
  const light = theme.data.base === 'vs' || theme.data.base === 'hc-light'
  const background = c['editor.background'] ?? (light ? '#ffffff' : '#1e1e1e')
  const text = c['editor.foreground'] ?? (light ? '#333333' : '#d4d4d4')
  return {
    id: theme.id,
    name: theme.name,
    kind: light ? 'light' : 'dark',
    source: 'VS Code',
    preview: {
      background,
      sideBar: c['sideBar.background'] ?? background,
      titleBar: c['titleBar.activeBackground'] ?? c['sideBar.background'] ?? background,
      accent: c['button.background'] ?? c['textLink.foreground'] ?? c['focusBorder'] ?? text,
      code: [rule('keyword') ?? text, rule('string') ?? text, rule('function') ?? rule('identifier') ?? text, rule('comment') ?? text, rule('number') ?? text],
    },
  }
}

function Picture({ preview }: { preview: ThemePreview }) {
  const lines: [number, number][] = [
    [0, 38],
    [1, 56],
    [2, 30],
    [3, 64],
    [4, 44],
  ]
  return (
    <svg className="forge-theme-picture" viewBox="0 0 120 72" role="img" aria-hidden="true">
      <rect width="120" height="72" fill={preview.background} />
      <rect width="120" height="9" fill={preview.titleBar} />
      <circle cx="6" cy="4.5" r="1.8" fill={preview.accent} />
      <rect y="9" width="26" height="63" fill={preview.sideBar} />
      <rect x="4" y="15" width="16" height="3" rx="1.5" fill={preview.accent} />
      <rect x="4" y="22" width="12" height="3" rx="1.5" fill={preview.code[3]} opacity="0.7" />
      <rect x="4" y="29" width="14" height="3" rx="1.5" fill={preview.code[3]} opacity="0.7" />
      {lines.map(([row, width]) => (
        <rect key={row} x={32 + (row % 2) * 6} y={16 + row * 9} width={width} height="4" rx="2" fill={preview.code[row % preview.code.length]} />
      ))}
      <rect x="32" y="62" width="22" height="4" rx="2" fill={preview.accent} />
    </svg>
  )
}

export function ThemePicker({
  selected,
  themes,
  onSelect,
  onRemove,
  onInstallFile,
  onInstallFolder,
  canImport,
}: {
  selected: string
  themes: ImportedTheme[]
  /** The VS Code import plugin is on: the install buttons and the hint are shown. */
  canImport: boolean
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onInstallFile: () => void
  onInstallFolder: () => void
}) {
  const [filter, setFilter] = useState('')
  const cards = useMemo(() => [...BUILTIN_THEME_CARDS, ...themes.map(cardOfImported)], [themes])
  const needle = filter.trim().toLowerCase()
  const shown = needle ? cards.filter((c) => c.name.toLowerCase().includes(needle)) : cards

  return (
    <div className="forge-theme-picker">
      <div className="forge-theme-bar">
        <input type="search" className="forge-theme-search" aria-label="Search themes" placeholder={`Search ${cards.length} themes`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        {canImport ? (
          <>
            <button type="button" className="is-primary" onClick={onInstallFile} title="A theme file (.json, .tmTheme) or an extension package (.vsix)">
              Install theme…
            </button>
            <button type="button" onClick={onInstallFolder} title="The folder of a VS Code theme extension, for example in C:\Users\you\.vscode\extensions">
              From folder…
            </button>
          </>
        ) : null}
      </div>
      <div className="forge-theme-grid" role="radiogroup" aria-label="Theme">
        {shown.map((card) => (
          <div key={card.id} className={`forge-theme-card${selected === card.id ? ' is-selected' : ''}`}>
            <button type="button" role="radio" aria-checked={selected === card.id} className="forge-theme-card-main" onClick={() => onSelect(card.id)}>
              <Picture preview={card.preview} />
              <span className="forge-theme-name">{card.name}</span>
              <span className="forge-theme-meta">
                {card.kind === 'dark' ? 'Dark' : 'Light'} · {card.source}
              </span>
              {selected === card.id ? <span className="forge-theme-check" aria-hidden="true">✓</span> : null}
            </button>
            {card.source === 'VS Code' ? (
              <button type="button" className="forge-theme-remove" aria-label={`Remove ${card.name}`} title="Remove this theme" onClick={() => onRemove(card.id)}>
                ×
              </button>
            ) : null}
          </div>
        ))}
        {shown.length === 0 ? <p className="forge-field-hint">No theme matches.</p> : null}
      </div>
      {canImport && themes.length === 0 ? <p className="forge-field-hint">No VS Code theme installed yet. Choose “Install theme…” or “From folder…” and pick a theme from your VS Code (C:\Users\you\.vscode\extensions).</p> : null}
    </div>
  )
}

/** A small window drawn with the colours the interface has right now, so a changed colour can be judged at once. */
export function LivePreview() {
  return (
    <div className="forge-live-preview" aria-hidden="true">
      <div className="forge-live-title">
        <i />
        <span>Dito Designer — Project</span>
      </div>
      <div className="forge-live-body">
        <div className="forge-live-side">
          <b>Projects</b>
          <span className="is-selected">entity</span>
          <span>context</span>
          <span className="is-muted">others</span>
        </div>
        <div className="forge-live-editor">
          <span><em className="kw">const</em> name = <em className="str">"Pichler"</em></span>
          <span><em className="cm">// comment</em></span>
          <span><em className="fn">open</em>(name, <em className="num">42</em>)</span>
          <div className="forge-live-buttons">
            <button type="button" tabIndex={-1}>OK</button>
            <span className="forge-live-error">Error</span>
            <span className="forge-live-warn">Warning</span>
            <span className="forge-live-ok">Success</span>
          </div>
        </div>
      </div>
    </div>
  )
}
