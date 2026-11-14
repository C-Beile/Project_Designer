import type { ComponentType } from 'react'
import * as toolbarIcons from '../../../shell/icons'
import { NodeIcon } from '../../../tree/treeIcons'
import type { TreeNode } from '../../../wire/types'
import { collectTokens } from './themePreview'
import { GalleryRow } from './GalleryRow'

const SIZE_TOKENS = new Set(['sm', 'md', 'lg', 'folder'])

function node(partial: Partial<TreeNode>): TreeNode {
  return { id: 'sample', label: 'sample', object_type: null, is_leaf: true, children: [], ...partial }
}

function suffixes(prefix: string): string[] {
  return collectTokens()
    .map((t) => t.name)
    .filter((n) => n.startsWith(prefix))
    .map((n) => n.slice(prefix.length))
}

export function IconsTab() {
  const toolbar = Object.entries(toolbarIcons).filter(([name, value]) => name.startsWith('Icon') && typeof value === 'function') as [string, ComponentType][]
  const objectTypes = suffixes('--icon-').filter((s) => !SIZE_TOKENS.has(s))
  const folders = suffixes('--folder-')
  return (
    <>
      <GalleryRow title="Toolbar and panel icons">
        {toolbar.map(([name, Icon]) => (
          <div key={name} className="ui-IconCell">
            <Icon />
            <code>{name.slice(4)}</code>
          </div>
        ))}
      </GalleryRow>
      <GalleryRow title="Tree: object types">
        {objectTypes.map((type) => (
          <div key={type} className="ui-IconCell">
            <NodeIcon node={node({ kind: 'object', object_type: type })} expanded={false} />
            <code>{type}</code>
          </div>
        ))}
      </GalleryRow>
      <GalleryRow title="Tree: folders (closed and open)">
        {folders.map((key) => (
          <div key={key} className="ui-IconCell">
            <NodeIcon node={node({ folder: key })} expanded={false} />
            <NodeIcon node={node({ folder: key })} expanded />
            <code>{key}</code>
          </div>
        ))}
      </GalleryRow>
      <GalleryRow title="Tree: project and files">
        <div className="ui-IconCell">
          <NodeIcon node={node({ kind: 'project' })} expanded={false} />
          <code>project</code>
        </div>
        {['readme.md', 'config.json', 'script.js', 'notes.txt'].map((label) => (
          <div key={label} className="ui-IconCell">
            <NodeIcon node={node({ kind: 'file', label })} expanded={false} />
            <code>{label}</code>
          </div>
        ))}
      </GalleryRow>
    </>
  )
}
