import type { ParsedTheme } from '../theme/themeToml'

/** Meldungen zu einer Theme-Datei, die von Hand oder außerhalb geändert wurde. Der Text selbst bleibt im Studio unsichtbar. */
export function StudioDiagnostics({ parsed, error }: { parsed: ParsedTheme | null; error: string | null }) {
  if (error) {
    return (
      <p role="alert" className="forge-field-error">
        This theme file cannot be read: {error}
      </p>
    )
  }
  if (!parsed?.warnings.length) return null
  return (
    <ul className="ui-Studio-warnings" aria-label="Warnings">
      {parsed.warnings.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  )
}
