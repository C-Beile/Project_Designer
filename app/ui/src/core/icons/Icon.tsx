import { ICONS, isIconName, type IconName } from './icons'
import { resolveIcon, type IconArea } from '../../config/styleConfig'

export type IconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
export type IconSize = 'sm' | 'md' | 'lg'

const SIZE: Record<IconSize, string> = { sm: 'var(--icon-sm)', md: 'var(--icon-md)', lg: 'var(--icon-lg)' }

/** Farbe für CSS: `text` erbt die Textfarbe des Elternteils (Hover, Deaktiviert), `muted` und `accent` folgen dem Theme, Hex bleibt Hex. */
export function iconColor(color: string | undefined): string | undefined {
  if (!color || color === 'text') return undefined
  return color === 'muted' ? 'var(--fg-muted)' : color === 'accent' ? 'var(--accent)' : color
}

export interface IconProps {
  name: IconName
  weight?: IconWeight
  size?: IconSize
  color?: string
  className?: string
}

/** Ein Phosphor-Icon. Größe über die Tokens `--icon-sm/md/lg`, Farbe standardmäßig die Textfarbe. */
export function Icon({ name, weight = 'regular', size = 'md', color, className }: IconProps) {
  const Component = ICONS[name]
  return <Component className={className} weight={weight} aria-hidden focusable={false} style={{ width: SIZE[size], height: SIZE[size], flex: 'none', color: iconColor(color) }} />
}

export interface ConfiguredIconProps {
  /** Name in `style.toml` (`[icon.<id>]`) und Bereich (Grundwerte). */
  id: string
  area: IconArea
  /** Icon, wenn `style.toml` für `id` keinen Namen setzt (oder einen unbekannten). */
  fallback: IconName
  size?: IconSize
  className?: string
}

/** Icon mit Name, Stil und Farbe aus `style.toml`: Einzel-Icon `[icon.<id>]` gewinnt gegen den Bereich `[icons.<area>]`. */
export function ConfiguredIcon({ id, area, fallback, size, className }: ConfiguredIconProps) {
  const r = resolveIcon(id, area)
  const name = r.name && isIconName(r.name) ? r.name : fallback
  return <Icon name={name} weight={r.weight as IconWeight} color={r.color} size={size} className={className} />
}

/** Auf-/Zuklapp-Pfeil. Id `chevron` in `style.toml` (Bereich `control`). */
export function Chevron({ open }: { open: boolean }) {
  return <ConfiguredIcon id="chevron" area="control" fallback={open ? 'caret-down' : 'caret-right'} size="sm" />
}

/** Kleiner Pfeil nach unten für Auswahllisten und Menüknöpfe. */
export function CaretDown() {
  return <Icon name="caret-down" weight="bold" size="sm" color="muted" />
}
