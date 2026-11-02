import type { ForgeApi } from '../api/ForgeApi'
import type { AliasConfigDto, AliasConfigTable, DeployPlan, TableDump, DbStatus, DiagnosticDto, FileHistory, ForgeSettings, GitCommit, GitOutput, GitOverview, SchemaTable, SqlResult, NavNode, PropKind, PropertySheet, SheetRow, TreeNode, UndoRedoOutcome, WireValue } from '../wire/types'
import { getAt, parseNodePath, setAt } from '../wire/path'

// In-memory stand-in for the real Tauri-backed `ForgeApi` (src/api/tauriApi.ts), mirroring
// `app/core/src/project_actor.rs`'s observable behaviour (per-node_id history, undo clears
// redo on a new edit, set_property returns the *whole* updated tree) closely enough that UI
// components under test can't tell the difference. Lets every component test in this app run
// with zero real Tauri/Rust process, per this agent's role brief ("verifiziere das
// programmatisch/automatisiert").
export function createMockForgeApi(options: {
  projectTree: TreeNode[]
  documents: Record<string, WireValue>
  // P7 (project-open-dialog): lets a test control what the "native" dialog/persistence would
  // return, without any real Tauri runtime.
  pickedFolder?: string | null
  recentProject?: string | null
  settings?: ForgeSettings
  detectedInstall?: string | null
  branch?: string | null
  // Several open projects: tree per project path; falls back to `projectTree` for any path.
  projectTrees?: Record<string, TreeNode[]>
  lazyChildren?: Record<string, TreeNode[]>
  openProjects?: string[]
  // Property catalog stand-in: groups per model type (root) or element tag (e.g. `entityField`).
  sheetDefs?: Record<string, MockGroupDef[]>
  // Model type per node id (root sheets); defaults to `object`.
  objectTypes?: Record<string, string>
  navigators?: Record<string, NavNode[]>
  // Delays the navigator answer so the "Please Wait…" state is observable.
  navigatorDelayMs?: number
  // Raw `.aod` text per node id for the Source tab; unlisted objects get a small generated document.
  sources?: Record<string, string>
  // Git history per file path for the History tab; unlisted files are "not in a repository".
  histories?: Record<string, FileHistory>
  // Services tab stand-ins: a failing connect (dbError), query results by exact SQL, tables, Git.
  dbError?: string
  // Makes every tunnel connect fail with this message.
  tunnelError?: string
  // Receives the arguments of every tunnelConnect call (tests check that a password is passed).
  tunnelCalls?: { row: import('../wire/types').TunnelRowDto; keyFile: string | null; hasPassword: boolean }[]
  aliasConfigs?: Record<string, import('../wire/types').AliasConfigDto[]>
  tunnelRows?: Record<string, import('../wire/types').TunnelRowDto[]>
  dbResults?: Record<string, SqlResult>
  dbTables?: SchemaTable[]
  // System-DB reads and the deploy (the write is recorded in `deployCalls`, never executed).
  systemUsers?: TableDump
  systemAliasConfigs?: AliasConfigTable
  systemAliasList?: AliasConfigDto[]
  deployPlan?: DeployPlan
  deployError?: string
  pickedFiles?: (string | null)[]
  git?: GitOverview
  // Source Control panel stand-in: status, history and the gutter of any file.
  scm?: import('../wire/types').ScmOverview
  scmHistory?: GitCommit[]
  scmGutter?: import('../wire/types').Gutter
  problems?: import('../wire/types').ProblemDto[]
  localData?: import('../wire/types').LocalDataInfo
  update?: import('../wire/types').UpdateInfo | null
  updateError?: string
  liquibaseError?: string
  onInstallUpdate?: () => void
  usages?: import('../wire/types').UsageDto[]
  // File > New, Rename and the zip export/import stand-ins (calls are recorded in 	reeCalls).
  newKinds?: import('../wire/types').NewObjectKind[]
  nameErrors?: Record<string, string>
  renamePlan?: import('../wire/types').RenamePlan
  projectModels?: import('../wire/types').ModelEntry[]
  zipModels?: import('../wire/types').ModelEntry[]
  jditoTypes?: import('../wire/types').JditoTypes | null
}): ForgeApi & { diagnosticsFor: (nodeId: string) => DiagnosticDto[]; dbCalls: { sql: string; allowWrite: boolean }[]; gitCalls: string[]; liquibaseCalls: string[]; treeCalls: string[]; deployCalls: string[]; connectCalls: string[]; enabledModifications: string[] } {
  const mockForwards = new Map<string, import('../wire/types').ForwardStatusDto>()
  const mockTunnelCalls = options.tunnelCalls ?? []
  const NO_DB_STATUS: DbStatus = { connected: false, tunnel_up: false, database: null, host: null }
  let db: DbStatus = NO_DB_STATUS
  const dbBy = new Map<string, DbStatus>()
  let activeDb = ''
  const dbCalls: { sql: string; allowWrite: boolean }[] = []
  const deployCalls: string[] = []
  const connectCalls: string[] = []
  const enabledModifications: string[] = []
  const gitCalls: string[] = []
  const liquibaseCalls: string[] = []
  const treeCalls: string[] = []
  let scmState: import('../wire/types').ScmOverview = options.scm ?? { root: '', branch: null, upstream: null, ahead: 0, behind: 0, files: [], truncated: false, branches: [], remote_branches: [] }
  let gitState: GitOverview = options.git ?? { root: '', branch: null, files: [], branches: [], remote_branches: [], commits: [] }
  const documents = { ...options.documents }
  type Entry = { path: string; old: WireValue | undefined; next: WireValue | undefined }
  const history: Record<string, { done: Entry[]; undone: Entry[] }> = {}
  let recentProject = options.recentProject ?? null
  let openProjects = [...(options.openProjects ?? [])]
  const sources: Record<string, string> = { ...(options.sources ?? {}) }
  let settings: ForgeSettings = options.settings ?? { designer_install_dir: null }

  function historyFor(nodeId: string) {
    if (!history[nodeId]) history[nodeId] = { done: [], undone: [] }
    return history[nodeId]
  }

  function outcomeFor(nodeId: string): UndoRedoOutcome {
    const h = historyFor(nodeId)
    return { tree: documents[nodeId], can_undo: h.done.length > 0, can_redo: h.undone.length > 0 }
  }

  return {
    async openProject(path) {
      return options.projectTrees?.[path] ?? options.projectTree
    },
    async listTreeChildren(nodeId) {
      return options.lazyChildren?.[nodeId] ?? []
    },
    async restoreOpenProjects() {
      return [...openProjects]
    },
    async addOpenProject(path) {
      if (path.trim() && !openProjects.includes(path)) openProjects.push(path)
      return [...openProjects]
    },
    async removeOpenProject(path) {
      openProjects = openProjects.filter((p) => p !== path)
      return [...openProjects]
    },
    async getPropertyTree(nodeId) {
      if (!(nodeId in documents)) throw new Error(`unknown node id '${nodeId}'`)
      return documents[nodeId]
    },
    async setProperty(nodeId, path, value) {
      const segments = parseNodePath(path)
      const old = getAt(documents[nodeId], segments)
      if (old === undefined) throw new Error(`node at path '${path}' does not exist`)
      documents[nodeId] = setAt(documents[nodeId], segments, value)
      const h = historyFor(nodeId)
      h.done.push({ path, old, next: value })
      h.undone = []
      return documents[nodeId]
    },
    async listDiagnostics() {
      return []
    },
    async executeAction(actionId) {
      throw new Error(`no action registered with id '${actionId}' (none registered in this round)`)
    },
    async undo(nodeId) {
      const h = historyFor(nodeId)
      const entry = h.done.pop()
      if (!entry) throw new Error('nothing to undo')
      documents[nodeId] = restore(documents[nodeId], entry.path, entry.old)
      h.undone.push(entry)
      return outcomeFor(nodeId)
    },
    async redo(nodeId) {
      const h = historyFor(nodeId)
      const entry = h.undone.pop()
      if (!entry) throw new Error('nothing to redo')
      documents[nodeId] = restore(documents[nodeId], entry.path, entry.next)
      h.done.push(entry)
      return outcomeFor(nodeId)
    },
    async save() {
      // no-op: the mock has no disk, matches ForgeApi's contract (fire-and-forget persistence)
    },
    async saveOverwrite() {},
    async reloadObject() {},
    async externalChanges() {
      return []
    },
    async projectChanged() {
      return false
    },
    async openLogFolder() {
      return 'C:/logs'
    },
    async openBackupFolder() {
      return 'C:/backups'
    },
    async logClientError() {
      return null
    },
    async readAliasConfigs(_root, reference) {
      return options.aliasConfigs?.[reference] ?? []
    },
    async readTunnelConfig(_root, reference) {
      return options.tunnelRows?.[reference] ?? []
    },
    async addTunnelRow(_root, reference, row) {
      const rows = (options.tunnelRows ??= {})
      rows[reference] = [...(rows[reference] ?? []), row]
      return rows[reference]
    },
    async deleteTunnelRow(_root, reference, index) {
      const rows = (options.tunnelRows ??= {})
      rows[reference] = (rows[reference] ?? []).filter((_, i) => i !== index)
      return rows[reference]
    },
    async readLinkedFile() {
      return '// mock linked file content\n'
    },
    async writeLinkedFile() {
      // no-op
    },
    async pickProjectFolder() {
      return options.pickedFolder ?? null
    },
    async getRecentProject() {
      return recentProject
    },
    async setRecentProject(path) {
      recentProject = path
    },
    async getSettings() {
      return settings
    },
    async setSettings(next) {
      settings = next
    },
    async detectDesignerInstall() {
      return options.detectedInstall ?? null
    },
    async getCurrentBranch() {
      return options.branch ?? null
    },
    async getPropertySheet(nodeId, path) {
      if (!(nodeId in documents)) throw new Error(`unknown node id '${nodeId}'`)
      return mockSheet(documents[nodeId], path, options.objectTypes?.[nodeId] ?? 'object', options.sheetDefs ?? {}, nodeId.includes('node_modules'))
    },
    async setSheetProperty(nodeId, path, name, value) {
      if (nodeId.includes('node_modules')) throw new Error('read-only module object')
      const full = path === '$' || path === '' ? name : `${path}.${name}`
      const old = getAt(documents[nodeId], parseNodePath(full))
      documents[nodeId] = writeField(documents[nodeId], full, value)
      const h = historyFor(nodeId)
      h.done.push({ path: full, old, next: value })
      h.undone = []
      return outcomeFor(nodeId)
    },
    async removeSheetProperty(nodeId, path, name) {
      if (nodeId.includes('node_modules')) throw new Error('read-only module object')
      const full = path === '$' || path === '' ? name : `${path}.${name}`
      const old = getAt(documents[nodeId], parseNodePath(full))
      if (old === undefined) throw new Error(`'${name}' is not set`)
      documents[nodeId] = writeField(documents[nodeId], full, undefined)
      const h = historyFor(nodeId)
      h.done.push({ path: full, old, next: undefined })
      h.undone = []
      return outcomeFor(nodeId)
    },
    async resetSheetProperty(nodeId, path, name) {
      if (nodeId.includes('node_modules')) return { tree: outcomeFor(nodeId), modification: { action: 'removed' as const, dir: 'mod-1' } }
      const full = path === '$' || path === '' ? name : `${path}.${name}`
      const old = getAt(documents[nodeId], parseNodePath(full))
      if (old === undefined) throw new Error(`'${name}' is not set`)
      documents[nodeId] = writeField(documents[nodeId], full, undefined)
      const h = historyFor(nodeId)
      h.done.push({ path: full, old, next: undefined })
      h.undone = []
      return { tree: outcomeFor(nodeId) }
    },
    async fileInfo(path) {
      return { name: path.split(/[\\/]/).pop() ?? path, extension: (path.split('.').pop() ?? ''), size: 12, modified_ms: 1_700_000_000_000, path }
    },
    async filePaste(_root, source, destDir) {
      return `${destDir}/${source.split(/[\\/]/).pop()}`
    },
    async fileRename(_root, path, newName) {
      return path.replace(/[^\\/]+$/, newName)
    },
    async fileDelete() {},
    async openInSystem() {},
    async npmRun() {
      return 0
    },
    async activateMapping(nodeId, path) {
      const real = path.replace('#new:', '.recordFieldMappings.dbRecordFieldMapping[0]#')
      return { path: real.replace('#', ''), tree: outcomeFor(nodeId) }
    },
    async resetSheetElement(nodeId, path) {
      if (nodeId.includes('node_modules')) throw new Error('comes from the module')
      const old = getAt(documents[nodeId], parseNodePath(path))
      if (old === undefined) throw new Error('This entry has no definition of its own')
      documents[nodeId] = writeField(documents[nodeId], path, undefined)
      const h = historyFor(nodeId)
      h.done.push({ path, old, next: undefined })
      h.undone = []
      return { tree: outcomeFor(nodeId) }
    },
    async findUsages() {
      return options.usages ?? []
    },
    async liquibaseTarget(system, alias) {
      liquibaseCalls.push(`target:${alias}`)
      return { system: system ?? 'C:/demo|dev1', host: 'db.example', database: 'cloud_data' }
    },
    async liquibaseUpdate(_system, alias, projectRoot) {
      liquibaseCalls.push(`update:${alias}:${projectRoot}`)
      if (options.liquibaseError) throw new Error(options.liquibaseError)
      return 'Liquibase update finished.'
    },
    async checkForUpdate() {
      if (options.updateError) throw new Error(options.updateError)
      return options.update ?? null
    },
    async installUpdate() {
      options.onInstallUpdate?.()
    },
    async localDataInfo() {
      return (
        options.localData ?? {
          app_version: '1.0.0-rc11',
          exe_dir: 'C:/Program Files/Vendira Designer',
          os: 'windows',
          arch: 'x86_64',
          forge_data_dir: 'C:/Users/u/AppData/Roaming/de.threehillsit.vendira-designer',
          forge_settings_file: 'C:/Users/u/AppData/Roaming/de.threehillsit.vendira-designer/settings.json',
          forge_entries: [{ name: 'settings.json', is_dir: false, size_bytes: 120, modified_unix: 1_700_000_000 }],
          designer_roaming_dir: 'C:/Users/u/AppData/Roaming/.aditodesigner',
          designer_roaming_exists: true,
          designer_versions: [{ name: '2020', path: 'C:/Users/u/AppData/Roaming/.aditodesigner/2020', size_bytes: 5_000_000, modified_unix: 1_600_000_000, days_unused: 400, outdated: true }],
          designer_install: null,
        }
      )
    },
    async scanProblems() {
      return options.problems ?? []
    },
    async enableModification(nodeId) {
      enabledModifications.push(nodeId)
    },
    async setModificationProperty() {
      return { action: 'unchanged' as const }
    },
    async setModificationScript() {
      return { action: 'unchanged' as const }
    },
    async discardModification() {},
    async getNavigator(nodeId) {
      if (options.navigatorDelayMs) await new Promise((r) => setTimeout(r, options.navigatorDelayMs))
      return options.navigators?.[nodeId] ?? []
    },
    async getObjectSource(nodeId) {
      if (!(nodeId in documents)) throw new Error(`unknown node id '${nodeId}'`)
      return { text: sources[nodeId] ?? `<entity>
  <name>${nodeId}</name>
</entity>
`, read_only: nodeId.includes('node_modules') }
    },
    async setObjectSource(nodeId, text) {
      if (nodeId.includes('node_modules')) throw new Error('read-only module object')
      const parsed = new DOMParser().parseFromString(text, 'application/xml')
      if (parsed.getElementsByTagName('parsererror').length > 0) {
        throw new Error('source rejected, document unchanged: the text is not well-formed XML')
      }
      sources[nodeId] = text
      const h = historyFor(nodeId)
      h.done.push({ path: '$source', old: undefined, next: { kind: 'text', value: text } })
      h.undone = []
      return outcomeFor(nodeId)
    },
    async getFileHistory(path) {
      return options.histories?.[path] ?? { in_repo: false, commits: [] }
    },
    async pickFile() {
      return options.pickedFiles?.shift() ?? null
    },
    async dbConnect(_tunnel, _server, keyFile, tunnelPassword, system) {
      connectCalls.push(tunnelPassword ? 'basic' : keyFile ? 'key' : 'agent')
      if (options.dbError) throw new Error(options.dbError)
      db = { connected: true, tunnel_up: true, database: '_____systemalias', host: 'adito-db.svc' }
      dbBy.set(system ?? '', db)
      activeDb = system ?? ''
      return db
    },
    async tunnelConnect(row, keyFile, tunnelPassword) {
      if (options.tunnelError) throw new Error(options.tunnelError)
      mockForwards.set(`${row.target_host}:${row.target_port}`, { target_host: row.target_host, target_port: row.target_port, local_port: 40000 + mockForwards.size, up: true })
      mockTunnelCalls.push({ row, keyFile, hasPassword: !!tunnelPassword })
      return mockForwards.get(`${row.target_host}:${row.target_port}`)!
    },
    async tunnelDisconnect(targetHost, targetPort) {
      mockForwards.delete(`${targetHost}:${targetPort}`)
    },
    async tunnelDisconnectAll() {
      mockForwards.clear()
    },
    async tunnelList() {
      return [...mockForwards.values()]
    },
    async systemTunnelState() {
      return { db_tunnel_up: false, target: null, problem: null }
    },
    async dbConnectAlias(system, alias) {
      const key = `${system}|alias:${alias}`
      db = { connected: true, tunnel_up: true, database: alias, host: 'adito-db.svc' }
      dbBy.set(key, db)
      activeDb = key
      return db
    },
    async dbCancelConnect() {
      // no-op
    },
    async cancelBuild() {
      return true
    },
    async dbDisconnect(system) {
      dbBy.delete(system ?? activeDb)
      if (system == null || system === activeDb) {
        activeDb = [...dbBy.keys()][0] ?? ''
        db = dbBy.get(activeDb) ?? NO_DB_STATUS
      }
    },
    async dbStatus(system) {
      return system != null ? (dbBy.get(system) ?? NO_DB_STATUS) : db
    },
    async dbSystems() {
      return [...dbBy.entries()].map(([system, status]) => ({ system, status, active: system === activeDb }))
    },
    async dbActivate(system) {
      if (!dbBy.has(system)) return false
      activeDb = system
      db = dbBy.get(system)!
      return true
    },
    async dbQuery(sql, allowWrite) {
      dbCalls.push({ sql, allowWrite })
      if (!db.connected) throw new Error('Not connected.')
      const hit = options.dbResults?.[sql]
      if (!hit) throw new Error('query failed: unknown statement')
      return hit
    },
    async dbSchema() {
      return options.dbTables ?? []
    },
    async systemUsers() {
      if (!db.connected) throw new Error('Not connected.')
      return options.systemUsers ?? { columns: [], rows: [], hidden_columns: [], truncated: false }
    },
    async systemAliasList() {
      if (!db.connected) throw new Error('Not connected.')
      return options.systemAliasList ?? []
    },
    async systemServerIds() {
      return ['dev']
    },
    async systemAliasConfigs() {
      if (!db.connected) throw new Error('Not connected.')
      return options.systemAliasConfigs ?? { table: { columns: [], rows: [], hidden_columns: [], truncated: false }, missing_required: [] }
    },
    async deployPlan(_root, force, mapping) {
      deployCalls.push(`plan:${force}:${mapping?.table ?? 'default'}`)
      if (options.deployError) throw new Error(options.deployError)
      if (!options.deployPlan) throw new Error('Not connected. Open the tunnel in the Services tab first.')
      return options.deployPlan
    },
    async deployShowChanges(_root, key) {
      return { local: `<local ${key}/>`, remote: key.endsWith('New') ? null : `<remote ${key}/>` }
    },
    async deployExecute(_root, keys, _force, _mapping, confirmed) {
      deployCalls.push(`execute:${confirmed}:${keys.join(',')}`)
      return { executed: keys.length, target: options.deployPlan?.target ?? '' }
    },
    async copyObject(source, destRoot, newName) {
      treeCalls.push(`copy:${source}->${destRoot}:${newName}`)
      return `/entity/${newName}/${newName}.aod`
    },
    async deleteObject(source) {
      treeCalls.push(`delete:${source}`)
    },
    async newObjectKinds() {
      return (
        options.newKinds ?? [
          { folder: 'entity', label: 'Entity', enabled: true, needs_title: false },
          { folder: 'neonContext', label: 'Context', enabled: true, needs_title: false, reference_label: 'Entity (optional)' },
          { folder: 'role', label: 'Role', enabled: true, needs_title: true },
          { folder: 'report', label: 'Report', enabled: false, hint: 'Needs a Jasper template', needs_title: false },
        ]
      )
    },
    async validateNewName(_root, folder, name) {
      return options.nameErrors?.[`${folder}/${name}`] ?? null
    },
    async createObject(_root, folder, name, title, reference) {
      treeCalls.push(`create:${folder}:${name}:${title ?? ''}:${reference ?? ''}`)
      return `/${folder}/${name}/${name}.aod`
    },
    async renamePlan(_root, source, newName) {
      treeCalls.push(`renamePlan:${source}->${newName}`)
      return options.renamePlan ?? { object: 'Old', new_name: newName, object_type: 'entity', changes: [], hits: [] }
    },
    async renameObject(_root, source, newName) {
      treeCalls.push(`rename:${source}->${newName}`)
      return source.replace(/[^\\/]+[\\/][^\\/]+$/, `/${newName}/${newName}.aod`)
    },
    async listProjectModels() {
      return options.projectModels ?? []
    },
    async exportProjectZip(_root, models, target) {
      treeCalls.push(`export:${models.map((m) => m.join('/')).join(',')}->${target}`)
      return models.length
    },
    async inspectProjectZip() {
      return options.zipModels ?? []
    },
    async importProjectZip(_root, zipPath, selected, overwrite) {
      treeCalls.push(`import:${zipPath}:${selected.map((m) => m.join('/')).join(',')}:${overwrite.map((m) => m.join('/')).join(',')}`)
      return { imported: selected.map((m) => m.join('/')), skipped: [] }
    },
    async pickSaveFile(_title, defaultName) {
      return options.pickedFiles?.shift() ?? `C:\\out\\${defaultName}`
    },
    async readJditoTypes() {
      return options.jditoTypes ?? null
    },
    async gitOverview() {
      if (!options.git) throw new Error('This project folder is not inside a Git repository.')
      return gitState
    },
    async gitCommit(_root, message, paths): Promise<GitOutput> {
      gitCalls.push(`commit:${message}:${paths.join(',')}`)
      gitState = { ...gitState, files: gitState.files.filter((f) => !paths.includes(f.path)), commits: [{ hash: 'abcdef12', author: 'T', date: '2026-10-13T10:00:00+02:00', subject: message }, ...gitState.commits] }
      return { ok: true, text: '1 file changed' }
    },
    async gitPull(): Promise<GitOutput> {
      gitCalls.push('pull')
      return { ok: true, text: 'Already up to date.' }
    },
    async gitPush(): Promise<GitOutput> {
      gitCalls.push('push')
      return { ok: true, text: 'Everything up-to-date' }
    },
    async gitCheckout(_root, branch): Promise<GitOutput> {
      gitCalls.push(`checkout:${branch}`)
      gitState = { ...gitState, branch, branches: gitState.branches.map((b) => ({ ...b, is_current: b.name === branch })) }
      return { ok: true, text: `Switched to branch '${branch}'` }
    },
    async gitCreateBranch(_root, name, start): Promise<GitOutput> {
      gitCalls.push(`newbranch:${name}${start ? `:${start}` : ''}`)
      gitState = { ...gitState, branch: name, branches: [...gitState.branches.map((b) => ({ ...b, is_current: false })), { name, is_current: true }] }
      return { ok: true, text: `Switched to a new branch '${name}'` }
    },
    async scmStatus() {
      if (!options.scm) throw new Error('This project folder is not inside a Git repository.')
      return scmState
    },
    async scmStage(_root, paths): Promise<GitOutput> {
      gitCalls.push(`stage:${paths.join(',')}`)
      scmState = { ...scmState, files: scmState.files.map((f) => (paths.includes(f.path) ? { ...f, index: f.index === '?' ? 'A' : f.worktree === 'D' ? 'D' : 'M', worktree: ' ' } : f)) }
      return { ok: true, text: '' }
    },
    async scmStageAll(): Promise<GitOutput> {
      gitCalls.push('stageAll')
      scmState = { ...scmState, files: scmState.files.map((f) => (f.path.endsWith('package-lock.json') || f.worktree === ' ' ? f : { ...f, index: f.index === '?' ? 'A' : 'M', worktree: ' ' })) }
      return { ok: true, text: '' }
    },
    async scmUnstage(_root, paths): Promise<GitOutput> {
      gitCalls.push(`unstage:${paths.join(',')}`)
      scmState = { ...scmState, files: scmState.files.map((f) => (paths.includes(f.path) ? (f.index === 'A' ? { ...f, index: '?', worktree: '?' } : { ...f, index: ' ', worktree: 'M' }) : f)) }
      return { ok: true, text: '' }
    },
    async scmDiscard(_root, paths): Promise<GitOutput> {
      gitCalls.push(`discard:${paths.join(',')}`)
      scmState = { ...scmState, files: scmState.files.filter((f) => !paths.includes(f.path)) }
      return { ok: true, text: '' }
    },
    async scmCommit(_root, message): Promise<GitOutput> {
      const staged = scmState.files.filter((f) => f.index !== ' ' && f.index !== '?')
      if (staged.length === 0) throw new Error('Nothing is staged. Stage the files to commit first.')
      if (staged.some((f) => f.path.endsWith('package-lock.json'))) throw new Error('package-lock.json is staged. It is never committed from here; unstage it first.')
      gitCalls.push(`scmcommit:${message}`)
      scmState = { ...scmState, ahead: scmState.ahead + 1, files: scmState.files.filter((f) => f.index === ' ' || f.index === '?') }
      return { ok: true, text: `${staged.length} file(s) changed` }
    },
    async scmSync(): Promise<GitOutput> {
      gitCalls.push('sync')
      scmState = { ...scmState, ahead: 0, behind: 0 }
      return { ok: true, text: 'Everything up-to-date' }
    },
    async scmHistory() {
      return options.scmHistory ?? []
    },
    async scmCommitFiles(_root, hash) {
      gitCalls.push(`commitFiles:${hash}`)
      return [{ status: 'M', path: 'entity/A/A.aod' }]
    },
    async scmDiff(_root, path, side, hash) {
      gitCalls.push(`diff:${side}:${path}${hash ? `:${hash}` : ''}`)
      return { original: 'old\n', modified: 'new\n', binary: false, too_large: false }
    },
    async scmGutter() {
      return options.scmGutter ?? { untracked: false, hunks: [] }
    },
    dbCalls,
    enabledModifications,
    deployCalls,
    connectCalls,
    gitCalls,
    liquibaseCalls,
    treeCalls,
    diagnosticsFor() {
      return []
    },
  }
}

export interface MockGroupDef {
  key: string
  label: string
  rows: { name: string; kind?: PropKind; description?: string; enum_values?: string[]; reference?: string }[]
}

function restore(root: WireValue, path: string, value: WireValue | undefined): WireValue {
  if (path === '$source') return root
  const segments = parseNodePath(path)
  if (value !== undefined && getAt(root, segments) !== undefined) return setAt(root, segments, value)
  return writeField(root, path, value)
}

/** Sets (or, with `undefined`, removes) the field at `path`, adding it when missing. */
function writeField(root: WireValue, path: string, value: WireValue | undefined): WireValue {
  const segments = parseNodePath(path)
  const last = segments[segments.length - 1]
  if (!last || last.kind !== 'field') return root
  const parentSegs = segments.slice(0, -1)
  const parent = getAt(root, parentSegs)
  if (!parent || parent.kind !== 'object') throw new Error(`no element at '${path}'`)
  const exists = parent.fields.some((f) => f.key === last.name)
  const fields =
    value === undefined
      ? parent.fields.filter((f) => f.key !== last.name)
      : exists
        ? parent.fields.map((f) => (f.key === last.name ? { key: f.key, value } : f))
        : [...parent.fields, { key: last.name, value }]
  return setAt(root, parentSegs, { kind: 'object', fields })
}

function scalarText(v: WireValue | undefined): string {
  if (!v) return ''
  if (v.kind === 'text') return v.value
  if (v.kind === 'bool' || v.kind === 'int') return String(v.value)
  if (v.kind === 'array') return v.items.map(scalarText).join(', ')
  return ''
}

function mockSheet(doc: WireValue, path: string, objectType: string, defs: Record<string, MockGroupDef[]>, readOnly: boolean): PropertySheet {
  const segments = parseNodePath(path)
  const element = getAt(doc, segments)
  if (!element || element.kind !== 'object') throw new Error(`no element at '${path}'`)
  const tags = segments.filter((s) => s.kind === 'field')
  const typeLabel = tags.length ? (tags[tags.length - 1] as { name: string }).name : objectType
  const name = scalarText(element.fields.find((f) => f.key === 'name')?.value) || typeLabel
  const reason = readOnly ? 'Objects of modules under node_modules are read-only.' : undefined
  const row = (rowName: string, kind: PropKind, extra: Partial<SheetRow> = {}): SheetRow => {
    const value = element.fields.find((f) => f.key === rowName)?.value
    const structural = kind === 'list' || kind === 'object' || kind === 'linked'
    return {
      name: rowName,
      kind,
      value,
      display: scalarText(value),
      set: value !== undefined,
      editable: !readOnly && !structural,
      reason: reason ?? (structural ? 'Editing lists is not available yet.' : undefined),
      typed: kind === 'bool' || kind === 'int',
      would_edit: !(kind === 'list' || kind === 'object'),
      ...extra,
    }
  }
  const groupDefs = defs[typeLabel]
  if (!groupDefs) {
    const rows = element.fields
      .filter((f) => f.key !== 'name' && f.value.kind !== 'object' && f.value.kind !== 'array')
      .map((f) => row(f.key, f.value.kind === 'bool' ? 'bool' : f.value.kind === 'int' ? 'int' : 'text'))
    return { name, type_label: typeLabel, path, groups: [{ key: 'GENERAL', label: '', rows }], read_only: reason, catalog_missing: true }
  }
  const groups = groupDefs.map((g) => ({
    key: g.key,
    label: g.label,
    rows: g.rows.map((r) =>
      row(r.name, r.kind ?? 'text', { description: r.description, enum_values: r.enum_values, reference: r.reference }),
    ),
  }))
  if (segments.length > 0 && element.fields.some((f) => f.key === 'name')) {
    groups[0].rows.unshift({ ...row('name', 'text'), editable: false, reason: 'Renaming is a refactoring and not available yet.' })
  }
  return { name, type_label: typeLabel, path, groups, read_only: reason, catalog_missing: false }
}
