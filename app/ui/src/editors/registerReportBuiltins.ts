import { registerEditor } from './registry'
import { ReportEditor } from './ReportEditor'

// Meldet `report` an. `registry.ts` bleibt unverändert, dieses Modul wird einmal in `App.tsx` importiert.
registerEditor('report', ReportEditor)
