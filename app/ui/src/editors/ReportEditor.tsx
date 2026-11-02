import type { EditorProps } from './registry'
import { field, textField, textValue } from '../wire/types'
import type { WireValue } from '../wire/types'
import { EditableText } from './EditableText'

// P4 seventh family (`ReportEditor`): the MUST subset of feature-matrix.md's `ReportEditor` entry
// (`ReportEditor`/`iReport` -> JasperReports, per the role brief). Own mini format analysis this
// agent ran against the real corpus (no P1 schema existed, see `p4-editor-report-notes.md` §1) -
// the object folder is `report` (the naively guessed name turned out correct this time, unlike
// `entityWebservice`), root element `report`. `name`/`majorModelMode` shown read-only (identity/
// constant, same precedent `LanguageEditor.tsx`/`SystemEditor.tsx` set). `title`/`description`/
// `comment` are the genuinely editable plain-text scalars - editable only where the real document
// already declares them (some real instances, e.g. the two Hermes reports, omit `title`
// entirely - same "editable only where the element already exists" precedent `ApplicationEditor.tsx`
// sets for `title`/`icon`). `alias` is shown read-only - it is a reference to an `aliasDefinition`
// object's own `name` (same "key is an identity, not free text" precedent `LanguageEditor.tsx`/
// `WebserviceEditor.tsx` set for `name`/`consumer`), and `forge_core::ProjectHandle::set_property`
// cannot validate that a typed replacement still resolves to a real alias anyway. `reportData`/
// `reportType`/`subReports`/`images` are all shown read-only, clearly labelled as carried
// JasperReports resources - `reportData`/each `subreport.reportData`/each `image.imageData` is a
// path into a `.jrxml`/`.png` file this editor never opens or writes (building a JasperReports
// design surface is explicitly out of scope per the role brief, same "linked file carried, not
// edited" precedent `architecture.md` §2 sets for `LinkedFileCompiler`). No `reportParameters`-
// shaped element was found anywhere in the real corpus (11 instances read in full) - the role
// brief's "Parameter soweit im Format vorhanden" MUST-subset item has nothing to build against
// here, so no parameters UI is shown (an honest gap, not an invented one).
export function ReportEditor({ nodeId, tree, api, onTreeChange }: EditorProps) {
  async function commitScalar(path: string, next: string) {
    const updated = await api.setProperty(nodeId, path, textValue(next))
    onTreeChange(updated)
  }

  const name = textField(tree, 'name') ?? ''
  const majorModelMode = textField(tree, 'majorModelMode') ?? ''
  const title = textField(tree, 'title')
  const description = textField(tree, 'description')
  const comment = textField(tree, 'comment')
  const alias = textField(tree, 'alias')
  const reportData = textField(tree, 'reportData') ?? ''
  const reportType = textField(tree, 'reportType') ?? ''
  const subreports = listEntries(field(tree, 'subReports'), 'subreport')
  const images = listEntries(field(tree, 'images'), 'image')

  return (
    <div className="report-editor">
      <h2>{name}</h2>
      <p className="report-editor-meta">
        Model mode: <code>{majorModelMode}</code>
        {reportType && (
          <>
            {' '}
            · Report engine: <code>{reportType}</code>
          </>
        )}
      </p>

      {title !== undefined && (
        <label>
          Title
          <EditableText value={title} ariaLabel="Title" onCommit={(next) => commitScalar('title', next)} />
        </label>
      )}
      {description !== undefined && (
        <label>
          Description
          <EditableText value={description} ariaLabel="Description" onCommit={(next) => commitScalar('description', next)} />
        </label>
      )}
      {comment !== undefined && (
        <label>
          Comment
          <EditableText value={comment} ariaLabel="Comment" onCommit={(next) => commitScalar('comment', next)} />
        </label>
      )}

      {alias !== undefined && (
        <p className="report-editor-alias">
          Data alias: <code>{alias}</code>
        </p>
      )}

      <section>
        <h3>Design source</h3>
        <p className="report-editor-warning">
          Carried JasperReports resource, not editable here - open <code>{reportData}</code> in a JasperReports designer.
        </p>
      </section>

      {subreports.length > 0 && (
        <section>
          <h3>Subreports</h3>
          <ul className="report-subreports">
            {subreports.map((entry) => {
              const subreportName = textField(entry.value, 'name') ?? ''
              const subreportData = textField(entry.value, 'reportData') ?? ''
              return (
                <li key={entry.path}>
                  <span className="report-subreport-name">{subreportName}</span> - <code>{subreportData}</code>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {images.length > 0 && (
        <section>
          <h3>Images</h3>
          <ul className="report-images">
            {images.map((entry) => {
              const imageName = textField(entry.value, 'name') ?? ''
              const fileName = textField(entry.value, 'fileName') ?? ''
              return (
                <li key={entry.path}>
                  <span className="report-image-name">{imageName}</span> - <code>{fileName}</code>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

interface ListEntry {
  path: string
  value: WireValue
}

// `subReports.subreport`/`images.image` independently hit the real R26 shape (RISKS.md) this
// object type has - a single real subreport/image projects as an un-indexed `Object`, 2+ as an
// indexed `Array` (see `report_validators.rs`'s module doc for the full real-corpus evidence:
// `Salesorder_report`'s single `subreport`/`image` vs. `Organisation_report`'s 4-element
// `subReports`/3-element `images` arrays). Handling both uniformly here is what makes
// `Salesorder_report`'s single subreport actually render instead of silently disappearing, same
// "stringListField"/"webserviceFieldEntries" precedent `WebserviceEditor.tsx` set.
function listEntries(container: WireValue | undefined, tagName: string): ListEntry[] {
  if (!container) return []
  const raw = field(container, tagName)
  if (!raw) return []
  if (raw.kind === 'array') return raw.items.map((item, i) => ({ path: `${tagName}[${i}]`, value: item }))
  if (raw.kind === 'object') return [{ path: tagName, value: raw }]
  return []
}
