import { CopyButton } from '../CopyButton'
import { DataTable } from '../DataTable'
import { ProgressBar } from '../ProgressBar'
import { GalleryRow } from './GalleryRow'
import { Button, Dropdown, Input, TextArea } from '../controls'

interface SampleRow {
  name: string
  type: string
  size: number
}

const ROWS: SampleRow[] = [
  { name: 'Person_entity', type: 'entity', size: 12 },
  { name: 'Order_entity', type: 'entity', size: 8 },
  { name: 'Customer_view', type: 'neonView', size: 3 },
]

const TOAST_KINDS = ['info', 'success', 'warning', 'error'] as const

/** Die Elemente, wie die App sie heute zeichnet: reine HTML-Elemente mit dem Stil der App und die gemeinsamen Bausteine aus core/ui. */
export function ElementsTab() {
  return (
    <>
      <GalleryRow title="Native elements">
        <Button variant="bare">Button</Button>
        <Button variant="bare" isDisabled>
          Disabled
        </Button>
        <Input type="text" defaultValue="Text input" aria-label="Text input" />
        <Input type="text" disabled defaultValue="Disabled input" aria-label="Disabled input" />
        <Dropdown aria-label="Select" value="b" onChange={() => {}} options={[{ id: 'a', label: 'Option A' }, { id: 'b', label: 'Option B' }]} />
        <TextArea aria-label="Text area" defaultValue={'Multi-line\ntext'} rows={2} />
        <label>
          <Input type="checkbox" defaultChecked /> Checkbox
        </label>
        <label>
          <Input type="radio" name="gallery-radio" defaultChecked /> Radio
        </label>
        <Input type="range" aria-label="Range" />
      </GalleryRow>
      <GalleryRow title="Text">
        <div>
          <h1>Heading 1</h1>
          <h2>Heading 2</h2>
          <h3>Heading 3</h3>
          <h4>Heading 4</h4>
          <p>
            Body text with a <a href="#gallery">link</a>, <code>inline code</code> and <kbd>Ctrl+S</kbd>.
          </p>
          <hr />
        </div>
      </GalleryRow>
      <GalleryRow title="Progress">
        <div className="ui-Gallery-wide">
          <ProgressBar percent={60} label="Determinate" />
          <ProgressBar label="Indeterminate" />
        </div>
      </GalleryRow>
      <GalleryRow title="Copy button">
        <CopyButton text="copied text" label="Copy" />
      </GalleryRow>
      <GalleryRow title="Table">
        <div className="ui-Gallery-wide">
          <DataTable
            ariaLabel="Sample table"
            rowKey={(r: SampleRow) => r.name}
            selection="single"
            columns={[
              { id: 'name', header: 'Name', value: (r: SampleRow) => r.name, sortable: true },
              { id: 'type', header: 'Type', value: (r: SampleRow) => r.type, sortable: true },
              { id: 'size', header: 'Files', value: (r: SampleRow) => r.size, sortable: true },
            ]}
            rows={ROWS}
          />
        </div>
      </GalleryRow>
      <GalleryRow title="Toast">
        <div className="ui-Gallery-wide ui-Gallery-toasts">
          {TOAST_KINDS.map((kind) => (
            <div key={kind} className={`forge-toast is-${kind}`} role="status">
              <span className="forge-toast-text">A {kind} message</span>
            </div>
          ))}
        </div>
      </GalleryRow>
    </>
  )
}
