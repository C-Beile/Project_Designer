import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { FileHistory } from '../wire/types'

// History sub-tab: read-only Git log of the file. Outside a repository this is a calm hint,
// not an error.

function shortDate(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <div className="forge-editor-empty">
      <p className="forge-field-hint">{children}</p>
    </div>
  )
}

export function HistoryView({ api, path }: { api: ForgeApi; path: string }) {
  const [history, setHistory] = useState<FileHistory | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setHistory(null)
    setFailed(false)
    api
      .getFileHistory(path)
      .then((h) => {
        if (!cancelled) setHistory(h)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [api, path])

  if (failed) return <Hint>The history could not be read.</Hint>
  if (!history) return <Hint>Please Wait…</Hint>
  if (!history.in_repo) return <Hint>This file is not under version control (no Git repository found).</Hint>
  if (history.commits.length === 0) return <Hint>No commits found for this file.</Hint>
  return (
    <div className="forge-history">
      <table className="forge-history-table" aria-label="File history">
        <thead>
          <tr>
            <th>Commit</th>
            <th>Author</th>
            <th>Date</th>
            <th>Subject</th>
          </tr>
        </thead>
        <tbody>
          {history.commits.map((c) => (
            <tr key={c.hash}>
              <td className="forge-history-hash" title={c.hash}>
                {c.hash.slice(0, 8)}
              </td>
              <td>{c.author}</td>
              <td>{shortDate(c.date)}</td>
              <td>{c.subject}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
