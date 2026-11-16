import { useMemo, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { ModelEntry } from '../wire/types'
import { Modal } from '../core/Modal'
import { errorText } from '../core/errorText'
import { Button, Dropdown, Input, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '../core/ui/controls'
import { useAbortableEffect } from '../core/hooks/useAbortableEffect'

// File > Export Project / Import Project, laid out like the manual's export window (img 011):
// "Export the entire system", one tab per data model type with picked/total counts, "Select all",
// a table Export | Data model | DATE_EDIT, OK / Cancel. NOT built: the DATE_EDIT filter and "Sign
// for system" (what they do is not documented); "Sign for system" is shown disabled. On import,
// models that already exist are skipped unless "Overwrite" is ticked; nothing is ever deleted.

const keyOf = (m: ModelEntry) => `${m.folder}/${m.name}`

function formatDate(secs: number): string {
  if (!secs) return ''
  const d = new Date(secs * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function ProjectZipDialog({
  api,
  projectRoot,
  mode,
  onClose,
  onDone,
}: {
  api: ForgeApi
  projectRoot: string
  mode: 'export' | 'import'
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [models, setModels] = useState<ModelEntry[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set())
  const [zipPath, setZipPath] = useState<string | null>(null)
  const [tab, setTab] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useAbortableEffect((signal) => {
    async function load() {
      try {
        let list: ModelEntry[]
        if (mode === 'export') {
          list = await api.listProjectModels(projectRoot)
        } else {
          const file = await api.pickFile('Import Project', 'Zip file', ['zip'])
          if (signal.aborted) return
          if (!file) {
            onClose()
            return
          }
          setZipPath(file)
          list = await api.inspectProjectZip(projectRoot, file)
        }
        if (signal.aborted) return
        setModels(list)
        setTab(list[0]?.folder ?? null)
        setPicked(new Set(list.map(keyOf)))
      } catch (e) {
        if (!signal.aborted) {
          setError(errorText(e))
          setModels([])
        }
      }
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projectRoot, mode])

  const folders = useMemo(() => [...new Set((models ?? []).map((m) => m.folder))], [models])
  const inTab = (models ?? []).filter((m) => m.folder === tab)
  const chosen = (models ?? []).filter((m) => picked.has(keyOf(m)))
  const pair = (m: ModelEntry): [string, string] => [m.folder, m.name]
  const allPicked = !!models && models.length > 0 && chosen.length === models.length
  const tabAllPicked = inTab.length > 0 && inTab.every((m) => picked.has(keyOf(m)))

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, k: string) => {
    const next = new Set(set)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setter(next)
  }
  const setMany = (list: ModelEntry[], on: boolean) => {
    const next = new Set(picked)
    for (const m of list) {
      if (on) next.add(keyOf(m))
      else next.delete(keyOf(m))
    }
    setPicked(next)
  }

  async function run() {
    if (chosen.length === 0) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'export') {
        const target = await api.pickSaveFile('Export Project', 'export.zip', 'Zip file', ['zip'])
        if (!target) {
          setBusy(false)
          return
        }
        const n = await api.exportProjectZip(projectRoot, chosen.map(pair), target)
        onDone(`Exported ${chosen.length} data model(s), ${n} file(s), to ${target}.`)
      } else if (zipPath) {
        const over = chosen.filter((m) => overwrite.has(keyOf(m))).map(pair)
        const out = await api.importProjectZip(projectRoot, zipPath, chosen.map(pair), over)
        onDone(`Imported ${out.imported.length} data model(s)${out.skipped.length ? `, skipped ${out.skipped.length} that already exist` : ''}.`)
      }
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={mode === 'export' ? 'Export Project' : 'Import Project'}
      onClose={onClose}
      footer={
        <>
          <Button variant="bare" isDisabled={busy || chosen.length === 0} onClick={() => void run()}>
            OK
          </Button>
          <Button variant="bare" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      {mode === 'import' && zipPath ? <p className="forge-field-hint">{zipPath}</p> : null}
      {models === null ? <p className="forge-field-hint">Reading...</p> : null}
      {models && models.length === 0 && !error ? <p className="forge-field-hint">No data models found.</p> : null}
      {models && models.length > 0 ? (
        <>
          <label className="forge-check">
            <Input type="checkbox" checked={allPicked} aria-label={mode === 'export' ? 'Export the entire system' : 'Import the entire system'} onChange={(e) => setMany(models, e.target.checked)} />
            <span>{mode === 'export' ? 'Export the entire system' : 'Import the entire system'}</span>
          </label>
          <div role="tablist" aria-label="Data model types" className="forge-zip-tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '8px 0' }}>
            {folders.map((f) => {
              const all = models.filter((m) => m.folder === f)
              const n = all.filter((m) => picked.has(keyOf(m))).length
              return (
                <Button variant="bare" key={f} role="tab" aria-selected={tab === f} onClick={() => setTab(f)}>
                  {f} {n}/{all.length}
                </Button>
              )
            })}
          </div>
          <label className="forge-check">
            <Input type="checkbox" checked={tabAllPicked} aria-label="Select all" onChange={(e) => setMany(inTab, e.target.checked)} />
            <span>Select all</span>
          </label>
          <div style={{ maxHeight: 300, overflow: 'auto', margin: '8px 0' }}>
            <Table className="forge-problems-table" aria-label="Data models">
              <TableHeader>

                  <TableColumn isRowHeader>Export</TableColumn>
                  <TableColumn>Data model</TableColumn>
                  <TableColumn>DATE_EDIT</TableColumn>

              </TableHeader>
              <TableBody>
                {inTab.map((m) => {
                  const k = keyOf(m)
                  return (
                    <TableRow key={k}>
                      <TableCell>
                        <Input type="checkbox" checked={picked.has(k)} aria-label={k} onChange={() => toggle(picked, setPicked, k)} />
                      </TableCell>
                      <TableCell>
                        {m.name}
                        {mode === 'import' && m.exists ? (
                          <label className="forge-check" style={{ marginLeft: 12 }}>
                            <Input type="checkbox" checked={overwrite.has(k)} aria-label={`Overwrite ${k}`} onChange={() => toggle(overwrite, setOverwrite, k)} />
                            <span>Exists: overwrite (nothing is deleted)</span>
                          </label>
                        ) : null}
                      </TableCell>
                      <TableCell>{formatDate(m.modified_secs)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <label className="forge-field">
            <span>Sign for system</span>
            <Dropdown isDisabled title="Not built: what signing does is not documented" aria-label="Sign for system" value="" options={[]} onChange={() => {}} />
          </label>
        </>
      ) : null}
      {error ? (
        <p className="forge-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  )
}
