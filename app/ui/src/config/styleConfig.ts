import { parse } from 'smol-toml'
import styleText from '../../../config/style.toml?raw'
import { checkSection, type Schema } from './configSchema'

const FILE = 'style.toml'

const px = (min: number, max: number) => ({ type: 'int', min, max }) as const
export const FONT_IDS = ['ibm-plex-mono', 'jetbrains-mono', 'source-code-pro', 'fira-code', 'consolas'] as const

const radiusSchema: Schema = { window: px(0, 16), control: px(0, 16), tab: px(0, 16), box: px(0, 16), badge: px(0, 16) }
const fontSchema: Schema = { ident: { type: 'enum', values: FONT_IDS }, code: { type: 'enum', values: FONT_IDS } }
const sizeSchema: Schema = {
  'control-h': px(16, 40), 'row-h': px(16, 40), 'tab-h': px(20, 48), 'compact-row-h': px(16, 40),
  'icon-sm': px(8, 24), 'icon-md': px(8, 32), 'icon-lg': px(12, 40),
}
const STYLES = ['line', 'fill', 'duotone'] as const
const THICKNESS = ['thin', 'light', 'regular', 'bold'] as const
const COLOR = { type: 'string', pattern: /^(text|muted|accent|#[0-9a-f]{6})$/i, hint: 'text | muted | accent | Hex wie #4aa8e8' } as const
const AREAS = ['toolbar', 'tree', 'control'] as const
const areaSchema: Schema = { style: { type: 'enum', values: STYLES }, thickness: { type: 'enum', values: THICKNESS }, color: COLOR }
const iconSchema: Schema = {
  name: { type: 'string', pattern: /^[a-z][a-z0-9-]*$/i, hint: 'Phosphor-Name in kebab-case', optional: true },
  style: { type: 'enum', values: STYLES, optional: true },
  thickness: { type: 'enum', values: THICKNESS, optional: true },
  color: { ...COLOR, optional: true },
}
const navigatorSchema: Schema = { 'module-hint': { type: 'enum', values: ['hover', 'column', 'off'] }, 'module-mark': { type: 'bool' } }
const motionSchema: Schema = { 'duration-fast': px(0, 1000), 'duration-normal': px(0, 1000), 'focus-width': px(1, 4) }

export type IconArea = (typeof AREAS)[number]
export type IconStyle = (typeof STYLES)[number]
export type IconThickness = (typeof THICKNESS)[number]

/** Grundwerte eines Bereichs (Toolbar, Baum, Steuerzeichen). */
export interface IconAreaConfig { style: IconStyle; thickness: IconThickness; color: string }
/** Einzel-Icon: jeder Wert ist optional und erbt sonst vom Bereich. */
export interface IconConfig { name?: string; style?: IconStyle; thickness?: IconThickness; color?: string }

export interface StyleConfig {
  radius: Record<string, number>
  font: { ident: string; code: string }
  size: Record<string, number>
  /** Grundwerte je Bereich. */
  areas: Record<IconArea, IconAreaConfig>
  /** Einzel-Icons (`[icon.<name>]`): Toolbar-Befehle und Objekttypen des Baums. */
  icons: Record<string, IconConfig>
  navigator: { moduleHint: string; moduleMark: boolean }
  motion: Record<string, number>
}

/** Phosphor-Gewicht aus Stil und Stärke: fill und duotone haben eigene Gewichte, line nimmt die Stärke. */
export function phosphorWeight(style: IconStyle, thickness: IconThickness): string {
  return style === 'line' ? thickness : style
}

/** Fertige Werte eines Icons: Einzel-Icon gewinnt, Rest kommt vom Bereich. `color` ist eine Farbe oder `text`, `muted`, `accent`. */
export function resolveIcon(id: string, area: IconArea, cfg: StyleConfig = styleConfig) {
  const base = cfg.areas[area]
  const own = cfg.icons[id] ?? {}
  const style = own.style ?? base.style
  const thickness = own.thickness ?? base.thickness
  return { name: own.name, weight: phosphorWeight(style, thickness), color: own.color ?? base.color }
}

/** Farbwert für CSS: `text`, `muted`, `accent` zeigen auf Variablen des Themes, Hex bleibt Hex. */
export function iconColorCss(color: string): string {
  return color === 'text' ? 'var(--fg)' : color === 'muted' ? 'var(--fg-muted)' : color === 'accent' ? 'var(--accent)' : color
}

/** Typen mit fester Akzentfarbe im Baum: gleich in allen Themes, werden zu `--folder-<typ>`. */
const TYPE_COLOR_IDS = [
  'system', 'preferences', 'application', 'context', 'notificationtype', 'entity', 'view', 'dashboard', 'renderer',
  'process', 'test', 'service', 'report', 'language', 'role', 'alias', 'others', 'plain',
] as const

export function parseStyleConfig(text: string): StyleConfig {
  const doc = parse(text) as Record<string, unknown>
  const radius = checkSection(FILE, 'radius', doc.radius, radiusSchema) as Record<string, number>
  const font = checkSection(FILE, 'font', doc.font, fontSchema) as { ident: string; code: string }
  const size = checkSection(FILE, 'size', doc.size, sizeSchema) as Record<string, number>
  const rawAreas = (doc.icons ?? {}) as Record<string, unknown>
  const areas = Object.fromEntries(
    AREAS.map((a) => [a, checkSection(FILE, `icons.${a}`, rawAreas[a], areaSchema)]),
  ) as unknown as Record<IconArea, IconAreaConfig>
  const rawIcons = (doc.icon ?? {}) as Record<string, unknown>
  const icons = Object.fromEntries(
    Object.entries(rawIcons).map(([id, v]) => [id, checkSection(FILE, `icon.${id}`, v, iconSchema)]),
  ) as Record<string, IconConfig>
  const nav = checkSection(FILE, 'navigator', doc.navigator, navigatorSchema)
  const motion = checkSection(FILE, 'motion', doc.motion, motionSchema) as Record<string, number>
  return {
    radius, font, size, areas, icons, motion,
    navigator: { moduleHint: nav['module-hint'] as string, moduleMark: nav['module-mark'] as boolean },
  }
}

export const styleConfig: StyleConfig = parseStyleConfig(styleText)

/** Schriftfolgen der Dropdown-Schriften. Der Name vorn ist die mitgelieferte Schrift. */
export const FONT_STACKS: Record<(typeof FONT_IDS)[number], string> = {
  'ibm-plex-mono': "'IBM Plex Mono', 'Cascadia Mono', Consolas, monospace",
  'jetbrains-mono': "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace",
  'source-code-pro': "'Source Code Pro', 'Cascadia Mono', Consolas, monospace",
  'fira-code': "'Fira Code', 'Cascadia Mono', Consolas, monospace",
  consolas: "Consolas, 'Cascadia Mono', monospace",
}

/** Anzeigenamen der Schriften für Dropdowns. */
export const FONT_LABELS: Record<(typeof FONT_IDS)[number], string> = {
  'ibm-plex-mono': 'IBM Plex Mono',
  'jetbrains-mono': 'JetBrains Mono',
  'source-code-pro': 'Source Code Pro',
  'fira-code': 'Fira Code',
  consolas: 'Consolas',
}

const rem = (px: number) => `${px / 16}rem`

/** CSS-Text mit den Werten aus `style.toml`. Rein, darum testbar. Zwei Regeln: Standard und Dichte "compact". */
export function styleConfigCss(cfg: StyleConfig = styleConfig): string {
  const r = cfg.radius
  const s = cfg.size
  const m = cfg.motion
  const stack = (id: string) => FONT_STACKS[id as keyof typeof FONT_STACKS]
  const colors = TYPE_COLOR_IDS.flatMap((id) => (cfg.icons[id]?.color ? [`--folder-${id}:${iconColorCss(cfg.icons[id].color!)}`] : [])).join(';')
  return `:root{${colors};
--radius-window:${r.window}px;--radius-control:${r.control}px;--radius-tab:${r.tab}px;--radius-box:${r.box}px;--radius-badge:${r.badge}px;
--font-ident:${stack(cfg.font.ident)};--font-code:${stack(cfg.font.code)};
--control-h:${rem(s['control-h'])};--row-h:${rem(s['row-h'])};--tab-h:${rem(s['tab-h'])};
--icon-sm:${rem(s['icon-sm'])};--icon-md:${rem(s['icon-md'])};--icon-lg:${rem(s['icon-lg'])};
--duration-fast:${m['duration-fast']}ms;--duration-normal:${m['duration-normal']}ms;--focus-width:${m['focus-width']}px}
:root[data-density='compact']{--row-h:${rem(s['compact-row-h'])}}
`
}

/**
 * Legt die Werte als eigenes `<style>` ans Ende von `<head>`. Das ist kein Inline-Stil: die Dichte
 * "compact" und die Nutzer-Einstellungen (`installAppearance`) setzen weiter ihre eigenen Werte darüber.
 */
export function applyStyleConfig(cfg: StyleConfig = styleConfig, doc: Document = document): void {
  let el = doc.getElementById('style-config')
  if (!el) {
    el = doc.createElement('style')
    el.id = 'style-config'
    doc.head.appendChild(el)
  }
  el.textContent = styleConfigCss(cfg)
}
