import { registerEditor } from './registry'
import { PreferencesEditor } from './PreferencesEditor'

// P4 fifth family's own registration call (part 2/3: `preferences`), same one-liner pattern every
// prior family established (p4-editor-entity-notes.md §2).
registerEditor('preferences', PreferencesEditor)
