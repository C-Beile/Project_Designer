import { IconSave } from '../../../shell/icons'
import { collectTokens, groupTokens, tokenValue } from './themePreview'
import { GalleryRow } from './GalleryRow'

function namesWithPrefix(...prefixes: string[]): string[] {
  const scales = groupTokens(collectTokens()).find(([g]) => g === 'Scales')?.[1] ?? []
  return scales.filter((n) => prefixes.some((p) => n.startsWith(p)))
}

export function ScalesTab({ version }: { version: number }) {
  return (
    <div data-version={version}>
      <GalleryRow title="Text sizes">
        <div className="ui-Scale-list">
          {namesWithPrefix('--text-').map((name) => (
            <p key={name} style={{ fontSize: `var(${name})` }}>
              <code>{name}</code> {tokenValue(name)} The quick brown fox jumps over the lazy dog
            </p>
          ))}
        </div>
      </GalleryRow>
      <GalleryRow title="Spacing">
        <div className="ui-Scale-list">
          {namesWithPrefix('--space-').map((name) => (
            <div key={name} className="ui-Scale-bar">
              <code>{name}</code>
              <span style={{ width: `var(${name})` }} />
              <small>{tokenValue(name)}</small>
            </div>
          ))}
        </div>
      </GalleryRow>
      <GalleryRow title="Corner radius">
        {namesWithPrefix('--radius-').map((name) => (
          <div key={name} className="ui-Scale-box" style={{ borderRadius: `var(${name})` }}>
            <code>{name}</code>
            <small>{tokenValue(name)}</small>
          </div>
        ))}
      </GalleryRow>
      <GalleryRow title="Icon sizes">
        {namesWithPrefix('--icon-').map((name) => (
          <div key={name} className="ui-Scale-icon">
            <span style={{ display: 'inline-flex', width: `var(${name})`, height: `var(${name})` }}>
              <IconSave />
            </span>
            <code>{name}</code>
            <small>{tokenValue(name)}</small>
          </div>
        ))}
      </GalleryRow>
      <GalleryRow title="Control and row heights">
        {namesWithPrefix('--control-', '--row-', '--tab-').map((name) => (
          <div key={name} className="ui-Scale-box">
            <code>{name}</code>
            <small>{tokenValue(name)}</small>
          </div>
        ))}
      </GalleryRow>
      <GalleryRow title="Layers (z-index)">
        <div className="ui-Scale-list">
          {namesWithPrefix('--z-').map((name) => (
            <p key={name}>
              <code>{name}</code> {tokenValue(name)}
            </p>
          ))}
        </div>
      </GalleryRow>
    </div>
  )
}
