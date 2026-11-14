import { configGet, onConfigChange, touches } from '../settings/appConfig'

export type Density = 'normal' | 'compact'

export interface Appearance {
  fontSize: number
  fontFamily: string
  density: Density
}

export const DEFAULT_FONT_SIZE = 12
export const FONT_SIZE_RANGE = [10, 18] as const
export const BASE_ROOT_PX = 16

const PATH = ['appearance'] as const

export function clampFontSize(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_FONT_SIZE
  return Math.min(FONT_SIZE_RANGE[1], Math.max(FONT_SIZE_RANGE[0], n))
}

/** Wurzelgröße in Pixeln: bei Schrift 12 genau 16px, sonst im gleichen Verhältnis. */
export function rootPixelSize(fontSize: number): number {
  return (BASE_ROOT_PX * fontSize) / DEFAULT_FONT_SIZE
}

export function readAppearance(): Appearance {
  const family = configGet<string>(...PATH, 'fontFamily')
  const density = configGet<string>(...PATH, 'density')
  return {
    fontSize: clampFontSize(configGet<number>(...PATH, 'fontSize')),
    fontFamily: typeof family === 'string' ? family.trim() : '',
    density: density === 'compact' ? 'compact' : 'normal',
  }
}

export function applyAppearance(a: Appearance = readAppearance(), root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--ui-font-size', String(a.fontSize))
  root.style.fontSize = `${rootPixelSize(a.fontSize)}px`
  if (a.fontFamily) root.style.setProperty('--font-ui', a.fontFamily)
  else root.style.removeProperty('--font-ui')
  if (a.density === 'compact') root.setAttribute('data-density', 'compact')
  else root.removeAttribute('data-density')
}

/** Wendet die Darstellung an und folgt Änderungen aus anderen Fenstern. */
export function installAppearance(): () => void {
  applyAppearance()
  return onConfigChange((path) => {
    if (touches(path, PATH)) applyAppearance()
  })
}
