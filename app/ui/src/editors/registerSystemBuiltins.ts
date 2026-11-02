import { registerEditor } from './registry'
import { SystemEditor } from './SystemEditor'

// P4 fifth family's own registration call (part 1/3: `system`), same one-liner pattern every prior
// family established (p4-editor-entity-notes.md §2) - `registry.ts` itself never changes, this
// module is imported once from `App.tsx`.
registerEditor('system', SystemEditor)
