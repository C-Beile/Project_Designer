import { createContext, useContext } from 'react'
import type { AliasConfigDto, TreeNode } from '../wire/types'

// Lets editors resolve a business name (e.g. a view referenced from another view) to the object
// in the open projects without knowing about the project tree itself.
export interface ProjectIndex {
  findObject: (objectType: string, name: string) => TreeNode | null
  openObject: (node: TreeNode) => void
  /** Entity of the context the view belongs to (the view preview takes field titles and types from it). */
  entityOfView?: (viewName: string) => TreeNode | null
  /** The `iconId` an object shows (a context or entity with an own icon), `undefined` when it has none. */
  iconOf?: (objectType: string, name: string) => string | undefined
  /** Names of all objects of one type in the open projects (menu editor list). */
  namesOf?: (objectType: string) => string[]
  /** Shows an element of the open object in the Properties panel (row click in an editor). */
  selectElement?: (nodeId: string, path: string, label: string) => void
  /** Opens the editor tab of one alias config of a system. */
  /** Shows an alias config of a system in the Properties panel (selection in the system editor). */
  selectAliasConfig?: (config: AliasConfigDto, system: string) => void
  /** Opens an SQL tab with `sql`; `systemKey` makes the SQL run on that system's database session. */
  openSql?: (sql: string, systemKey?: string) => void
  openAliasConfig?: (ref: { key: string; system: string; alias: string; reference: string; browse?: boolean; tunnelConfig?: string }) => void
  /** The element selected in Navigator, Properties or an editor right now. */
  selection?: { nodeId: string; path: string } | null
  /** Removes an element of the open object (Set to Default of the element); module objects through a modification. */
  removeElement?: (nodeId: string, path: string, label: string) => void
}

export const ProjectIndexContext = createContext<ProjectIndex | null>(null)

export function useProjectIndex(): ProjectIndex | null {
  return useContext(ProjectIndexContext)
}
