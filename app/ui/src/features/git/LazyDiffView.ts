import { lazy } from 'react'

// Lazy, damit Monaco erst beim ersten Diff-Tab geladen wird.
export const LazyDiffView = lazy(() => import('./DiffView').then((m) => ({ default: m.DiffView })))
