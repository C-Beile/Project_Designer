import { useMemo, useState } from 'react'
import type { DeployChangeView } from '../wire/types'
import { Modal } from './Dialogs'

// Side-by-side comparison of one model: the version on the system (left) against the version of the
// project (right), as in the original Designer ("Diff Deploy <model>"). Lines that exist on one side
// only are marked; whitespace can be ignored when comparing.

export interface DiffRow {
  left: { no: number; text: string } | null
  right: { no: number; text: string } | null
  kind: 'same' | 'removed' | 'added' | 'changed'
}

const MAX_CELLS = 4_000_000

/** Aligns two texts line by line; a block of removed lines next to a block of added lines is shown as changed pairs. */
export function diffRows(remote: string | null, local: string | null, ignoreWhitespace: boolean): DiffRow[] {
  const split = (t: string | null) => (t === null ? [] : t.replace(/\r\n/g, '\n').split('\n'))
  const a = split(remote)
  const b = split(local)
  const key = (l: string) => (ignoreWhitespace ? l.replace(/\s+/g, '') : l)
  const ka = a.map(key)
  const kb = b.map(key)

  let start = 0
  while (start < ka.length && start < kb.length && ka[start] === kb[start]) start++
  let endA = ka.length
  let endB = kb.length
  while (endA > start && endB > start && ka[endA - 1] === kb[endB - 1]) {
    endA--
    endB--
  }

  const ops: ('same' | 'del' | 'add')[] = []
  for (let i = 0; i < start; i++) ops.push('same')
  const n = endA - start
  const m = endB - start
  if (n * m > MAX_CELLS) {
    // Too large for an exact comparison: lines that occur on the other side count as unchanged.
    const inB = new Set(kb.slice(start, endB))
    const inA = new Set(ka.slice(start, endA))
    for (let i = start; i < endA; i++) ops.push(inB.has(ka[i]) ? 'same' : 'del')
    for (let j = start; j < endB; j++) if (!inA.has(kb[j])) ops.push('add')
  } else {
    const width = m + 1
    const table = new Uint32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] = ka[start + i] === kb[start + j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (ka[start + i] === kb[start + j]) {
        ops.push('same')
        i++
        j++
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
        ops.push('del')
        i++
      } else {
        ops.push('add')
        j++
      }
    }
    while (i++ < n) ops.push('del')
    while (j++ < m) ops.push('add')
  }
  for (let i = endA; i < ka.length; i++) ops.push('same')

  const rows: DiffRow[] = []
  let ia = 0
  let ib = 0
  let k = 0
  while (k < ops.length) {
    if (ops[k] === 'same') {
      rows.push({ left: { no: ia + 1, text: a[ia] }, right: { no: ib + 1, text: b[ib] }, kind: 'same' })
      ia++
      ib++
      k++
      continue
    }
    const removed: number[] = []
    const added: number[] = []
    while (k < ops.length && ops[k] !== 'same') {
      if (ops[k] === 'del') removed.push(ia++)
      else added.push(ib++)
      k++
    }
    const pairs = Math.max(removed.length, added.length)
    for (let p = 0; p < pairs; p++) {
      const l = removed[p]
      const r = added[p]
      rows.push({
        left: l === undefined ? null : { no: l + 1, text: a[l] },
        right: r === undefined ? null : { no: r + 1, text: b[r] },
        kind: l !== undefined && r !== undefined ? 'changed' : l !== undefined ? 'removed' : 'added',
      })
    }
  }
  return rows
}

export function DeployDiffDialog({ name, view, onClose }: { name: string; view: DeployChangeView; onClose: () => void }) {
  const [ignore, setIgnore] = useState(true)
  const rows = useMemo(() => diffRows(view.remote, view.local, ignore), [view, ignore])
  const differing = rows.filter((r) => r.kind !== 'same').length
  return (
    <Modal
      title={`Diff Deploy ${name}`}
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="forge-ddiff">
        <div className="forge-ddiff-bar">
          <span className="forge-field-hint" role="status">
            {view.remote === null ? 'New on the system.' : view.local === null ? 'Removed from the project.' : differing === 0 ? 'No line differs.' : `${differing} differing line${differing === 1 ? '' : 's'}`}
          </span>
          <label>
            <span>Whitespace Treatment:</span>
            <select aria-label="Whitespace Treatment" value={ignore ? 'ignore' : 'keep'} onChange={(e) => setIgnore(e.target.value === 'ignore')}>
              <option value="ignore">Ignore all whitespace</option>
              <option value="keep">Do not ignore whitespace</option>
            </select>
          </label>
        </div>
        <div className="forge-ddiff-head">
          <span>DB version</span>
          <span>Designer version</span>
        </div>
        <div className="forge-ddiff-body" role="table" aria-label="Changes of the model">
          {rows.map((r, i) => (
            <div key={i} role="row" className={`forge-ddiff-row is-${r.kind}`}>
              <span className="forge-ddiff-no">{r.left?.no ?? ''}</span>
              <span className="forge-ddiff-text forge-ddiff-left">{r.left?.text ?? ''}</span>
              <span className="forge-ddiff-no">{r.right?.no ?? ''}</span>
              <span className="forge-ddiff-text forge-ddiff-right">{r.right?.text ?? ''}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
