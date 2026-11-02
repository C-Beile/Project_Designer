import { registerEditor } from './registry'
import { ReportEditor } from './ReportEditor'

// P4 seventh family's own registration call (`report`), same one-liner pattern every prior family
// established (p4-editor-entity-notes.md §2) - `registry.ts` itself never changes, this module is
// imported once from `App.tsx`.
registerEditor('report', ReportEditor)
