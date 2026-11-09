import { registerEditor } from './registry'
import { ViewCanvasEditor } from './ViewCanvasEditor'
import { ContextEditor } from './ContextEditor'
import { DashboardEditor } from './DashboardEditor'
import { EntityEditor } from './EntityEditor'

// Meldet `neonView`, `neonContext`, `neonDashboard` an. `registry.ts` bleibt unverändert, dieses Modul wird einmal in `App.tsx` importiert.
registerEditor('neonView', ViewCanvasEditor)
registerEditor('neonContext', ContextEditor)
registerEditor('neonDashboard', DashboardEditor)
registerEditor('entity', EntityEditor)
