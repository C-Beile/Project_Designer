import { registerEditor } from './registry'
import { ApplicationEditor } from './ApplicationEditor'

// Meldet `application` an. `registry.ts` bleibt unverändert, dieses Modul wird einmal in `App.tsx` importiert.
registerEditor('application', ApplicationEditor)
