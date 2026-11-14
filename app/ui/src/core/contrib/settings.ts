import { useSyncExternalStore } from 'react'
import { configGet, configSet, onConfigChange, touches } from '../../settings/appConfig'
import { isPluginAvailable } from '../plugins/registry'
import { createStore } from '../store'

interface SettingBase {
  /** Eindeutige Id, z. B. `appearance.fontSize`. */
  id: string
  /** Seite oder Gruppe, in der `SchemaForm` die Einstellung zeigt. */
  page: string
  label: string
  hint?: string
  /** Ort in `designer.conf`: `['appearance', 'fontSize']` = Schlüssel `fontSize` in `[appearance]`. */
  path: readonly string[]
  order?: number
  plugin?: string
}

export type SettingSpec = SettingBase &
  (
    | { kind: 'bool'; default: boolean }
    | { kind: 'text'; default: string; placeholder?: string }
    | { kind: 'int'; default: number; min: number; max: number; unit?: string }
    | { kind: 'enum'; default: string; options: { id: string; label: string }[] }
  )

type Value = boolean | string | number

const settings = createStore<SettingSpec[]>([])

/** Neue Einstellung = ein Aufruf. Der Wert steht in `designer.conf`; der Standardwert wird nie gespeichert. */
export function registerSetting(spec: SettingSpec): () => void {
  settings.update((list) => [...list.filter((s) => s.id !== spec.id), spec])
  return () => settings.update((list) => list.filter((s) => s !== spec))
}

export function getSettings(page: string): SettingSpec[] {
  return settings
    .get()
    .filter((s) => s.page === page && (s.plugin === undefined || isPluginAvailable(s.plugin)))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function useSettings(page: string): SettingSpec[] {
  settings.use()
  return getSettings(page)
}

/** Gespeicherter Wert in der richtigen Art, sonst der Standard. */
export function readSetting(spec: SettingSpec): Value {
  const raw = configGet<unknown>(...spec.path)
  switch (spec.kind) {
    case 'bool':
      return typeof raw === 'boolean' ? raw : spec.default
    case 'text':
      return typeof raw === 'string' ? raw : spec.default
    case 'int':
      return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(spec.max, Math.max(spec.min, raw)) : spec.default
    case 'enum':
      return typeof raw === 'string' && spec.options.some((o) => o.id === raw) ? raw : spec.default
  }
}

export function writeSetting(spec: SettingSpec, value: Value): void {
  const clamped = spec.kind === 'int' && typeof value === 'number' ? Math.min(spec.max, Math.max(spec.min, Math.round(value))) : value
  configSet(spec.path, clamped === spec.default || clamped === '' ? undefined : clamped)
}

export function useSettingValue(spec: SettingSpec): Value {
  return useSyncExternalStore(
    (listener) => onConfigChange((changed) => touches(changed, spec.path) && listener()),
    () => readSetting(spec),
  )
}

export function _resetSettingsForTests(): void {
  settings.set([])
}
