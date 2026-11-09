import type { CompareReport } from '../wire/types'
import { Modal } from '../core/Modal'
import { DataTable, ProgressBar, type DataColumn } from '../core/ui'

// How far the built-in transpiler is: the share of the files of the official output that it reproduces
// byte for byte, and the biggest groups of files that still differ.

type Group = CompareReport['groups'][number]

const COLUMNS: DataColumn<Group>[] = [
  { id: 'count', header: 'Files', value: (g) => g.count },
  { id: 'folder', header: 'Folder', value: (g) => g.folder },
  { id: 'kind', header: 'Type', value: (g) => g.kind },
  { id: 'reason', header: 'Reason', value: (g) => g.reason },
  { id: 'example', header: 'Example', value: (g) => g.example, title: (g) => g.example },
]

export function TranspileMatchDialog({ report, reference, onChangeReference, onClose }: { report: CompareReport; reference: string; onChangeReference: () => void; onClose: () => void }) {
  return (
    <Modal
      title="Transpile Match"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onChangeReference}>
            Change Reference...
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="forge-match">
        <p className="forge-match-percent" aria-label="Match">
          <strong>{report.percent.toFixed(2)} %</strong> of the {report.total} files of the reference are identical.
        </p>
        <ProgressBar percent={report.percent} label="Match with the reference" />
        <p className="forge-field-hint" title={reference}>
          Reference: {reference}
        </p>
        <p>
          {report.different - report.missing} differ, {report.missing} are missing, {report.own_only} exist only in the Dito_Transpiler output.
        </p>
        {report.groups.length > 0 ? (
          <DataTable className="forge-match-table" ariaLabel="Differences" columns={COLUMNS} rows={report.groups} rowKey={(g) => `${g.folder}|${g.kind}|${g.reason}`} />
        ) : (
          <p className="forge-field-hint">No file differs.</p>
        )}
      </div>
    </Modal>
  )
}
