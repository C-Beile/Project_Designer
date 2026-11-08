import { useEffect, useMemo, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { ModelEntry } from '../wire/types'
import { Modal } from '../core/Modal'
import { errorText } from '../core/errorText'

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

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        let list: ModelEntry[]
        if (mode === 'export') {
          list = await api.listProjectModels(projectRoot)
        } else {
          const file = await api.pickFile('Import Project', 'Zip file', ['zip'])
          if (cancelled) return
          if (!file) {
            onClose()
            return
          }
          setZipPath(file)
          list = await api.inspectProjectZip(projectRoot, file)
        }
        if (cancelled) return
        setModels(list)
        setTab(list[0]?.folder ?? null)
        setPicked(new Set(list.map(keyOf)))
      } catch (e) {
        if (!cancelled) {
          setError(errorText(e))
          setModels([])
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
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
          <button type="button" disabled={busy || chosen.length === 0} onClick={() => void run()}>
            OK
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      {mode === 'import' && zipPath ? <p className="forge-field-hint">{zipPath}</p> : null}
      {models === null ? <p className="forge-field-hint">Reading...</p> : null}
      {models && models.length === 0 && !error ? <p className="forge-field-hint">No data models found.</p> : null}
      {models && models.length > 0 ? (
        <>
          <label className="forge-check">
            <input type="checkbox" checked={allPicked} aria-label={mode === 'export' ? 'Export the entire system' : 'Import the entire system'} onChange={(e) => setMany(models, e.target.checked)} />
            <span>{mode === 'export' ? 'Export the entire system' : 'Import the entire system'}</span>
          </label>
          <div role="tablist" aria-label="Data model types" className="forge-zip-tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '8px 0' }}>
            {folders.map((f) => {
              const all = models.filter((m) => m.folder === f)
              const n = all.filter((m) => picked.has(keyOf(m))).length
              return (
                <button key={f} type="button" role="tab" aria-selected={tab === f} onClick={() => setTab(f)}>
                  {f} {n}/{all.length}
                </button>
              )
            })}
          </div>
          <label className="forge-check">
            <input type="checkbox" checked={tabAllPicked} aria-label="Select all" onChange={(e) => setMany(inTab, e.target.checked)} />
            <span>Select all</span>
          </label>
          <div style={{ maxHeight: 300, overflow: 'auto', margin: '8px 0' }}>
            <table className="forge-problems-table" aria-label="Data models">
              <thead>
                <tr>
                  <th>Export</th>
                  <th>Data model</th>
                  <th>DATE_EDIT</th>
                </tr>
              </thead>
              <tbody>
                {inTab.map((m) => {
                  const k = keyOf(m)
                  return (
                    <tr key={k}>
                      <td>
                        <input type="checkbox" checked={picked.has(k)} aria-label={k} onChange={() => toggle(picked, setPicked, k)} />
                      </td>
                      <td>
                        {m.name}
                        {mode === 'import' && m.exists ? (
                          <label className="forge-check" style={{ marginLeft: 12 }}>
                            <input type="checkbox" checked={overwrite.has(k)} aria-label={`Overwrite ${k}`} onChange={() => toggle(overwrite, setOverwrite, k)} />
                            <span>Exists: overwrite (nothing is deleted)</span>
                          </label>
                        ) : null}
                      </td>
                      <td>{formatDate(m.modified_secs)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <label className="forge-field">
            <span>Sign for system</span>
            <select disabled title="Not built: what signing does is not documented" aria-label="Sign for system" />
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
