import { lazy } from 'react'

// Öffentliche Seite des Git-Features; Fremdcode importiert nur von hier.
export { registerGitPlugin } from './gitPlugin'
export { GitDialog } from './GitDialog'
export { SyncDialog, type SyncResult } from './SyncDialog'
export { CommitDiffDialog } from './CommitDiffDialog'
export { ScmPanel } from './ScmPanel'
export { decorationFor, indexOf, refreshScm, useScm, GIT_CODE_LABEL, _resetScmForTests } from './scmStore'
export { diffTitle } from './diffTitle'

// Lazy, damit Monaco erst beim ersten Diff-Tab geladen wird.
export const LazyDiffView = lazy(() => import('./DiffView').then((m) => ({ default: m.DiffView })))
