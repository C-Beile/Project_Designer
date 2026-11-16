import { pathKey } from '../platform/pathKey'

export const PROJECT_COLOR_COUNT = 8

/** Die Farbe (CSS-Wert) des Projekts: die Stelle in der Liste der offenen Projekte bestimmt sie. Ohne Treffer: `undefined`. */
export function projectColor(root: string | undefined, projects: readonly string[]): string | undefined {
  if (!root) return undefined
  const key = pathKey(root)
  const i = projects.findIndex((p) => pathKey(p) === key)
  return i < 0 ? undefined : `var(--project-${(i % PROJECT_COLOR_COUNT) + 1})`
}
