import { SECTION_TREE, setConfigSection, useConfigSection, type SectionNode } from '../properties/configSections'

// Navigator of the alias config `_____CONFIGURATION` (shot 102544): the tree of its sections. The
// selected node decides what the config editor and the Properties panel show.

function Node({ node, depth, selected }: { node: SectionNode; depth: number; selected: string }) {
  return (
    <>
      <button
        type="button"
        role="treeitem"
        aria-selected={node.id === selected}
        className={`nav-row${node.id === selected ? ' is-selected' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => setConfigSection(node.id)}
      >
        <span className="nav-label">{node.label}</span>
      </button>
      {node.children.map((c) => (
        <Node key={c.id} node={c} depth={depth + 1} selected={selected} />
      ))}
    </>
  )
}

export function ConfigNavigator() {
  const selected = useConfigSection()
  return (
    <div className="nav-config" role="tree" aria-label="Config sections">
      <Node node={SECTION_TREE} depth={0} selected={selected} />
    </div>
  )
}
