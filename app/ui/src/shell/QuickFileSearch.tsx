import { useEffect, useMemo, useRef, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'

// Double Ctrl: search the file names of the open projects (names only, never the content). The
// files are listed once per open; typing narrows the list, Enter or a click opens the file.

const MAX_SHOWN = 80

/** Entries whose name contains all words of the query; name matches rank above path matches. */
export function matchFiles(files: string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return files.slice(0, MAX_SHOWN)
  const scored: { file: string; score: number }[] = []
  for (const file of files) {
    const lower = file.toLowerCase()
    if (!words.every((w) => lower.includes(w))) continue
    const name = lower.slice(lower.lastIndexOf('/') + 1)
    const inName = words.every((w) => name.includes(w))
    const starts = words.length === 1 && name.startsWith(words[0])
    scored.push({ file, score: (starts ? 0 : inName ? 1 : 2) * 1000 + name.length })
  }
  scored.sort((a, b) => a.score - b.score)
  return scored.slice(0, MAX_SHOWN).map((s) => s.file)
}

/** Opens `onOpen` when Ctrl is pressed twice within 400 ms without another key in between. */
export function useDoubleCtrl(onTrigger: () => void) {
  const cb = useRef(onTrigger)
  cb.current = onTrigger
  useEffect(() => {
    let last = 0
    let clean = false
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Control' && !e.repeat) {
        const now = Date.now()
        if (clean && now - last < 400) {
          last = 0
          clean = false
          cb.current()
          return
        }
        last = now
        clean = true
      } else if (e.key !== 'Control') {
        clean = false
      }
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [])
}

export function QuickFileSearch({ api, projectRoots, onOpen, onClose }: { api: ForgeApi; projectRoots: string[]; onOpen: (path: string) => void; onClose: () => void }) {
  const [files, setFiles] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all(projectRoots.map((r) => api.listProjectFiles(r).then((list) => list.map((f) => `${r.replace(/[\\/]+$/, '').replace(/\\/g, '/')}/${f}`))))
      .then((all) => !cancelled && setFiles(all.flat()))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [api, projectRoots])

  const shown = useMemo(() => matchFiles(files ?? [], query), [files, query])
  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    listRef.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const pick = (path: string | undefined) => {
    if (!path) return
    onClose()
    onOpen(path)
  }
  const name = (p: string) => p.slice(p.lastIndexOf('/') + 1)
  const folder = (p: string) => {
    const root = projectRoots.map((r) => r.replace(/[\\/]+$/, '').replace(/\\/g, '/')).find((r) => p.startsWith(`${r}/`))
    const rel = root ? p.slice(root.length + 1) : p
    return rel.slice(0, Math.max(0, rel.lastIndexOf('/')))
  }

  return (
    <div className="forge-qs-backdrop" onMouseDown={onClose}>
      <div
        className="forge-qs"
        role="dialog"
        aria-label="Search files"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setIndex((i) => Math.min(shown.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setIndex((i) => Math.max(0, i - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            pick(shown[index])
          }
        }}
      >
        <input autoFocus type="text" placeholder="Search file names..." aria-label="File name" value={query} onChange={(e) => setQuery(e.target.value)} />
        {error ? <p className="forge-field-error">{error}</p> : null}
        {files === null && !error ? <p className="forge-field-hint">Reading the files…</p> : null}
        {files !== null ? (
          <ul ref={listRef} role="listbox" aria-label="Files">
            {shown.map((p, i) => (
              <li key={p} role="option" aria-selected={i === index} className={i === index ? 'is-selected' : undefined} onMouseMove={() => setIndex(i)} onClick={() => pick(p)}>
                <span className="forge-qs-name">{name(p)}</span>
                <span className="forge-qs-folder">{folder(p)}</span>
              </li>
            ))}
            {shown.length === 0 ? <li className="forge-qs-empty">No file found</li> : null}
          </ul>
        ) : null}
        <div className="forge-qs-hint">Press Ctrl twice to open · names only, not the content · Enter opens · Esc closes</div>
      </div>
    </div>
  )
}
