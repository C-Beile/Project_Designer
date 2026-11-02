import { registerEditor } from './registry'
import { AliasDbEditor } from './AliasDbEditor'

// P4 third family's own registration call, exactly the pattern `registerBuiltins.ts` (entity) and
// `registerViewContextDashboardBuiltins.ts` (P4 second family) established: `registry.ts` itself
// never changes, this module is imported once from `App.tsx` as the single new import line for
// this whole family (p4-editor-entity-notes.md §2).
registerEditor('aliasDefinition', AliasDbEditor)
