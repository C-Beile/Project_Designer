import { registerEditor } from './registry'
import { PreferencesEditor } from './PreferencesEditor'

// Meldet `preferences` an. `registry.ts` bleibt unverändert, dieses Modul wird einmal in `App.tsx` importiert.
registerEditor('preferences', PreferencesEditor)
