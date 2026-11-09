import type { ForgeApi } from '../api/ForgeApi'
import { isPluginAvailable } from '../core/plugins/registry'
import { registerGitPlugin } from './git'

// Alle UI-Plugins an einem Ort. Neues Plugin: hier eintragen (Id = Id des Rust-Plugins).
const FEATURES: Record<string, () => () => void> = {
  git: registerGitPlugin,
}

/**
 * Meldet die UI-Beiträge der Plugins an, die das Backend wirklich hat (Cargo-Features, `plugin_list`).
 * Schlägt `plugin_list` fehl, werden alle angemeldet. Jedes Fenster ruft das für sich auf.
 */
export async function registerFeaturePlugins(api: ForgeApi): Promise<void> {
  const register = (id: string) => {
    if (!isPluginAvailable(id)) FEATURES[id]()
  }
  try {
    const list = await api.pluginList!()
    for (const id of Object.keys(FEATURES)) if (list.some((p) => p.id === id && p.available)) register(id)
  } catch {
    Object.keys(FEATURES).forEach(register)
  }
}
