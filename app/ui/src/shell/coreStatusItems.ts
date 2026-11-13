import { registerStatusBarItem } from '../core/plugins/registry'
import { IndexStatusItem } from './IndexStatusItem'

/** Statusleisten-Beiträge des Kerns (ohne `plugin`). Aufruf beim Start (App.tsx) und in test/setup.ts. */
export function registerCoreStatusItems(): () => void {
  return registerStatusBarItem({ id: 'core.index', align: 'left', order: 10, component: IndexStatusItem })
}
