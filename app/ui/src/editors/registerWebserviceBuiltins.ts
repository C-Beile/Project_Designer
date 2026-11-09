import { registerEditor } from './registry'
import { WebserviceEditor } from './WebserviceEditor'

// Meldet `entityWebservice` an. `registry.ts` bleibt unverändert, dieses Modul wird einmal in `App.tsx` importiert.
registerEditor('entityWebservice', WebserviceEditor)
