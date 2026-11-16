import { useResource } from '../core/hooks/useResource'
import type { ReactNode } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '../core/ui/controls'

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
  const loaded = useResource(() => api.getFileHistory(path), [api, path], [], { clearOnReload: true })
  const history = loaded.data ?? null
  const failed = !!loaded.error

  if (failed) return <Hint>The history could not be read.</Hint>
  if (!history) return <Hint>Please Wait…</Hint>
  if (!history.in_repo) return <Hint>This file is not under version control (no Git repository found).</Hint>
  if (history.commits.length === 0) return <Hint>No commits found for this file.</Hint>
  return (
    <div className="forge-history">
      <Table className="forge-history-table" aria-label="File history">
        <TableHeader>

            <TableColumn isRowHeader>Commit</TableColumn>
            <TableColumn>Author</TableColumn>
            <TableColumn>Date</TableColumn>
            <TableColumn>Subject</TableColumn>

        </TableHeader>
        <TableBody>
          {history.commits.map((c) => (
            <TableRow key={c.hash}>
              <TableCell className="forge-history-hash" title={c.hash}>
                {c.hash.slice(0, 8)}
              </TableCell>
              <TableCell>{c.author}</TableCell>
              <TableCell>{shortDate(c.date)}</TableCell>
              <TableCell>{c.subject}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
