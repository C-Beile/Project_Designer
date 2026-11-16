import { collectTokens, groupTokens, isColorValue, tokenValue } from './themePreview'
import { GalleryRow } from './GalleryRow'

/** Alle Variablen der Stylesheets mit ihrem Wert im gewählten Theme. `version` zwingt nach einem Themewechsel zum Neulesen. */
export function ColorsTab({ version }: { version: number }) {
  const groups = groupTokens(collectTokens()).filter(([group]) => group !== 'Scales')
  if (groups.length === 0) return <p className="ui-Gallery-empty">No variables found in the loaded stylesheets.</p>
  return (
    <div data-version={version}>
      {groups.map(([group, names]) => (
        <GalleryRow key={group} title={group}>
          {names.map((name) => {
            const value = tokenValue(name)
            return (
              <div key={name} className="ui-Swatch" title={`${name}: ${value}`}>
                {isColorValue(value) ? <span className="ui-Swatch-chip" style={{ background: `var(${name})` }} /> : null}
                <code>{name}</code>
                <small>{value}</small>
              </div>
            )
          })}
        </GalleryRow>
      ))}
    </div>
  )
}
