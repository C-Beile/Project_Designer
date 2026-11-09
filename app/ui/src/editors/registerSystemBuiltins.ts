import { registerEditor } from './registry'
import { SystemEditor } from './SystemEditor'

// Meldet `system` an. `registry.ts` bleibt unverändert, dieses Modul wird einmal in `App.tsx` importiert.
registerEditor('system', SystemEditor)
