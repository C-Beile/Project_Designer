import { registerEditor } from './registry'
import { LanguageEditor } from './LanguageEditor'

// P4 fourth family's own registration call, exactly the pattern `registerBuiltins.ts` (entity),
// `registerViewContextDashboardBuiltins.ts` (P4 second family) and `registerAliasDbBuiltins.ts`
// (P4 third family) established: `registry.ts` itself never changes, this module is imported once
// from `App.tsx` as the single new import line for this whole family
// (p4-editor-entity-notes.md §2).
registerEditor('language', LanguageEditor)
