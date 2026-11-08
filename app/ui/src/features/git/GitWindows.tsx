import { useRef } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { GitDialog } from './GitDialog'
import { SyncDialog, type SyncResult } from './SyncDialog'

// Inhalt der Git- und Pull/Push-Fenster (OS-Fenster). Die Fenster-Hülle (`windows/DialogWindowApp`)
// holt sie über das Register (`git.window`, `git.syncWindow`) und gibt Nutzlast und `done` mit.

export interface GitWindowProps {
  api: ForgeApi
  payload: Record<string, unknown>
  done: (result: unknown) => void
}

// The Git window reports whether the work tree changed, so the main window reloads its tree.
export function GitWindow({ api, payload, done }: GitWindowProps) {
  const changed = useRef(false)
  const lastMessage = useRef<{ message: string; ok: boolean } | null>(null)
  return (
    <GitDialog
      api={api}
      projectRoot={String(payload.project ?? '')}
      initialTab={payload.tab === 'history' || payload.tab === 'branches' ? payload.tab : 'changes'}
      initialTarget={(payload.target as { local?: string; remote?: string } | null) ?? null}
      onChanged={() => {
        changed.current = true
      }}
      onResult={(message, ok) => {
        lastMessage.current = { message, ok }
      }}
      onClose={() => done(changed.current || lastMessage.current ? { changed: changed.current, ...lastMessage.current } : null)}
    />
  )
}

export interface SyncWindowResult {
  mode: 'pull' | 'push'
  changed: boolean
  result: SyncResult
}

// The Pull and Push window reports what the last run did, so the main window can tell the user and reload its tree.
export function SyncWindow({ api, payload, done }: GitWindowProps) {
  const changed = useRef(false)
  const last = useRef<SyncResult | null>(null)
  const mode = payload.mode === 'push' ? 'push' : 'pull'
  return (
    <SyncDialog
      api={api}
      projectRoot={String(payload.project ?? '')}
      mode={mode}
      onDone={() => {
        changed.current = true
      }}
      onResult={(r) => {
        last.current = r
      }}
      onClose={() => done(last.current ? ({ mode, changed: changed.current, result: last.current } satisfies SyncWindowResult) : null)}
    />
  )
}
