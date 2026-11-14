import { Button, Checkbox, Select, Slider, TextField } from '../controls'
import { GalleryRow } from './GalleryRow'

const FONT_OPTIONS = [
  { id: 'segoe', label: 'Segoe UI' },
  { id: 'inter', label: 'Inter' },
  { id: 'system', label: 'System default' },
]

export function ControlsTab() {
  return (
    <>
      <GalleryRow title="Button">
        <Button>Default</Button>
        <Button variant="primary">Primary</Button>
        <Button variant="quiet">Quiet</Button>
        <Button isDisabled>Disabled</Button>
      </GalleryRow>
      <GalleryRow title="TextField">
        <TextField label="Name" placeholder="Object name" />
        <TextField label="With hint" description="Letters and digits only" defaultValue="Customer" />
        <TextField label="With error" isInvalid errorMessage="Name already exists" defaultValue="Taken" />
        <TextField label="Disabled" isDisabled defaultValue="Read only" />
      </GalleryRow>
      <GalleryRow title="Checkbox">
        <Checkbox>Unchecked</Checkbox>
        <Checkbox defaultSelected>Checked</Checkbox>
        <Checkbox isDisabled>Disabled</Checkbox>
      </GalleryRow>
      <GalleryRow title="Select">
        <Select label="Font" options={FONT_OPTIONS} defaultSelectedKey="segoe" />
      </GalleryRow>
      <GalleryRow title="Slider">
        <Slider label="Text size" unit="px" minValue={10} maxValue={18} defaultValue={12} />
      </GalleryRow>
    </>
  )
}
