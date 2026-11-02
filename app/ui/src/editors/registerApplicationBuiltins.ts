import { registerEditor } from './registry'
import { ApplicationEditor } from './ApplicationEditor'

// P4 fifth family's own registration call (part 3/3: `application`), same one-liner pattern every
// prior family established (p4-editor-entity-notes.md §2).
registerEditor('application', ApplicationEditor)
