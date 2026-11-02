import { registerEditor } from './registry'
import { WebserviceEditor } from './WebserviceEditor'

// P4 sixth family's own registration call (`entityWebservice`), same one-liner pattern every prior
// family established (p4-editor-entity-notes.md §2) - `registry.ts` itself never changes, this
// module is imported once from `App.tsx`.
registerEditor('entityWebservice', WebserviceEditor)
