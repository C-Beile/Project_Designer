import { registerEditor } from './registry'
import { AliasDbEditor } from './AliasDbEditor'

// Meldet `aliasDefinition` an. `registry.ts` bleibt unverändert, dieses Modul wird einmal in `App.tsx` importiert.
registerEditor('aliasDefinition', AliasDbEditor)
