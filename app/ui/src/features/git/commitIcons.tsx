import { ConfiguredIcon, Icon } from '../../core/icons/Icon'

// Icons of the original commit dialog (reference shots 61, 62, 66): three toolbar glyphs above the
// tree, a blue folder, a plain document and a document with braces for JSON files.

export function ExpandAllIcon() {
  return <Icon name="arrows-out-simple" size="lg" />
}

export function CollapseAllIcon() {
  return <Icon name="arrows-in-simple" size="lg" />
}

export function ListToggleIcon() {
  return <Icon name="list-bullets" size="lg" />
}

export function Chevron({ open }: { open: boolean }) {
  return <ConfiguredIcon id="chevron" area="control" fallback={open ? 'caret-down' : 'caret-right'} size="sm" />
}

export function FolderIcon() {
  return <Icon name="folder" weight="fill" size="md" color="var(--icon-folder)" />
}

export function FileIcon({ json }: { json?: boolean }) {
  return <Icon name={json ? 'brackets-curly' : 'file-text'} size="md" />
}
