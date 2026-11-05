import type { CompareReport } from '../wire/types'
import { Modal } from './Dialogs'

// How far the built-in transpiler is: the share of the files of the official output that it reproduces
// byte for byte, and the biggest groups of files that still differ.

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
        <div className="forge-progress-bar" role="progressbar" aria-label="Match with the reference" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(report.percent)}>
          <div className="forge-progress-bar-fill" style={{ width: `${report.percent}%` }} />
        </div>
        <p className="forge-field-hint" title={reference}>
          Reference: {reference}
        </p>
        <p>
          {report.different - report.missing} differ, {report.missing} are missing, {report.own_only} exist only in the Dito_Transpiler output.
        </p>
        {report.groups.length > 0 ? (
          <table className="forge-match-table" aria-label="Differences">
            <thead>
              <tr>
                <th>Files</th>
                <th>Folder</th>
                <th>Type</th>
                <th>Reason</th>
                <th>Example</th>
              </tr>
            </thead>
            <tbody>
              {report.groups.map((g) => (
                <tr key={`${g.folder}|${g.kind}|${g.reason}`}>
                  <td>{g.count}</td>
                  <td>{g.folder}</td>
                  <td>{g.kind}</td>
                  <td>{g.reason}</td>
                  <td title={g.example}>{g.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="forge-field-hint">No file differs.</p>
        )}
      </div>
    </Modal>
  )
}
