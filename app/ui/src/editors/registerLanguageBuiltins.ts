import { registerEditor } from './registry'
import { LanguageEditor } from './LanguageEditor'

// Meldet `language` an. `registry.ts` bleibt unverändert, dieses Modul wird einmal in `App.tsx` importiert.
registerEditor('language', LanguageEditor)
