import { parse } from 'smol-toml'
import limitsText from '../../../config/limits.toml?raw'
import { checkSection, type Schema } from './configSchema'

const FILE = 'limits.toml'

const windowsSchema: Schema = {
  'max-popups': { type: 'int', min: 1, max: 10 },
  'max-editor-windows': { type: 'int', min: 1, max: 10 },
}

export interface LimitsConfig {
  windows: { maxPopups: number; maxEditorWindows: number }
}

export function parseLimitsConfig(text: string): LimitsConfig {
  const doc = parse(text) as Record<string, unknown>
  const w = checkSection(FILE, 'windows', doc.windows, windowsSchema)
  return { windows: { maxPopups: w['max-popups'] as number, maxEditorWindows: w['max-editor-windows'] as number } }
}

export const limitsConfig: LimitsConfig = parseLimitsConfig(limitsText)
