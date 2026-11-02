import { registerEditor } from './registry'
import { ViewCanvasEditor } from './ViewCanvasEditor'
import { ContextEditor } from './ContextEditor'
import { DashboardEditor } from './DashboardEditor'
import { EntityEditor } from './EntityEditor'

// P4 second family's own registration call, exactly the pattern `registerBuiltins.ts` (entity)
// established: `registry.ts` itself never changes, this module is imported once from `App.tsx`
// as the single new import line for this whole family (p4-editor-entity-notes.md §2).
registerEditor('neonView', ViewCanvasEditor)
registerEditor('neonContext', ContextEditor)
registerEditor('neonDashboard', DashboardEditor)
registerEditor('entity', EntityEditor)
