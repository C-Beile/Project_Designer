import { useEffect } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { applyIndexProgress, applyIndexStatus, getIndexState, removeIndexProject } from '../../core/indexStatus'
import type { IndexProgress } from '../../wire/types'
import { listenBackend } from './backendEvent'

// Hört `forge://index-progress` und füllt den Index-Store. Nach einem Fenster-Reload fragt er je Projekt
// einmal den Stand ab. Projekte, die geschlossen wurden, verschwinden aus dem Store.
export function useIndexStatus(api: ForgeApi, projects: string[]) {
  useEffect(
    () =>
      listenBackend('forge://index-progress', (p) => {
        const e = p as IndexProgress
        if (e && typeof e.project === 'string') applyIndexProgress(e)
      }),
    [],
  )

  const key = projects.join('|')
  useEffect(() => {
    const open = projects.filter((p) => p.trim())
    for (const p of open) {
      void api
        .indexStatus(p)
        .then((s) => {
          if (s) applyIndexStatus(s)
        })
        .catch(() => {})
    }
    for (const known of Object.keys(getIndexState().projects)) {
      if (!open.includes(known)) removeIndexProject(known)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key])
}
