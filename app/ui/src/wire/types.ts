// Mirrors crates/project/src/wire.rs's `WireValue`/`WireField` exactly (same tag names, same field
// order semantics) - this is the one place the frontend needs to know the IPC shape. Business
// meaning: one ADITO object's whole property tree, or one field's value.

export type WireValue =
  | { kind: 'text'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'int'; value: number }
  | { kind: 'object'; fields: WireField[] }
  | { kind: 'array'; items: WireValue[] }

export interface WireField {
  key: string
  value: WireValue
}

export function textValue(value: string): WireValue {
  return { kind: 'text', value }
}

/** Business meaning: read one named field off an object-shaped wire value (e.g. an entity's `title`). */
export function field(value: WireValue | undefined, name: string): WireValue | undefined {
  if (!value || value.kind !== 'object') return undefined
  return value.fields.find((f) => f.key === name)?.value
}

/** Convenience for the common "read this field's text" case; undefined if missing/not text. */
export function textField(value: WireValue | undefined, name: string): string | undefined {
  const v = field(value, name)
  return v?.kind === 'text' ? v.value : undefined
}

/** Convenience for a typed-scalar `<foo v="0" />` field (core-model projects it as a leaf `Int`
 * scalar directly, see `crates/project/src/view_context_dashboard_validators.rs`'s own comment on this)
 * - read-only display use, used by `DashboardEditor.tsx` for grid position fields that
 * `forge-core`'s write-back path does not support editing yet (only `Text`-content scalars do). */
export function intField(value: WireValue | undefined, name: string): number | undefined {
  const v = field(value, name)
  return v?.kind === 'int' ? v.value : undefined
}

/** Convenience for a typed-scalar `<foo v="true" />` field's boolean projection - same read-only
 * rationale as `intField` above (`AliasDbEditor.tsx` uses it for `primaryKey`/`notNull`/etc., which
 * `forge-core`'s write-back path does not support editing yet). */
export function boolField(value: WireValue | undefined, name: string): boolean | undefined {
  const v = field(value, name)
  return v?.kind === 'bool' ? v.value : undefined
}

export function asArray(value: WireValue | undefined): WireValue[] {
  return value?.kind === 'array' ? value.items : []
}

// Mirrors crates/project/src/tree.rs's `TreeNode`. Optional fields are omitted by the backend when
// empty/false. `id` is the absolute file path for objects and files (what getPropertyTree/save
// take) and not unique within a tree: the same entity shows in `entity` and below its context.
export type TreeNodeKind = 'project' | 'folder' | 'object' | 'file' | 'dir' | 'libraries' | 'module' | 'service' | 'tunnel' | 'aliasconfig' | 'rest'

export interface TreeNode {
  id: string
  label: string
  object_type: string | null
  /** No expander: no children and nothing to load lazily. */
  is_leaf: boolean
  children: TreeNode[]
  kind?: TreeNodeKind
  /** `@scope/name:version` of the module the object comes from; absent for the project's own. */
  origin?: string
  /** Packages that change this module object through modifications (LAYOUT_SPEC §4.5). */
  overrides?: string[]
  read_only?: boolean
  dimmed?: boolean
  bold?: boolean
  /** Children come from `listTreeChildren` on first expand. */
  lazy?: boolean
  /** Project root of a module project: its system folder is greyed out and it is normally not built. */
  module_project?: boolean
  /** Type-folder key for the folder colour (`--folder-<key>`). */
  folder?: string
  /** `iconId` of the object itself (a context or entity with an icon); shown instead of the type symbol. */
  icon?: string
  /** Project property "Name", shown in brackets behind the project name. */
  type_label?: string
  /** Display path (forward slashes) of project roots and External Libraries modules. */
  path?: string
  /** Tab of a linked code property (`kind: 'file'`): which property of which object it belongs to. */
  code?: CodeTarget
  /** Diff tab of the Source Control panel (kind `service`): the file and the two compared versions. */
  diff?: DiffTarget
}

/** A code property opened as an editor tab of its own, as the original opens the .js file in the editor area. */
export interface CodeTarget {
  ownerNodeId: string
  ownerName: string
  /** Element path inside the object, `$` for the object itself. */
  path: string
  prop: string
  /** `%aditoprj%`-relative file reference. */
  reference: string
  /** `%aditoprj%` folder the reference is resolved against. */
  linkedRoot: string
  /** Property not set yet: the file is created on the first save. */
  isNew: boolean
}

/** Opening an object or file means double-click/Enter; folders only expand. */
export function isOpenable(node: TreeNode): boolean {
  const kind = node.kind ?? (node.object_type ? 'object' : 'folder')
  return (kind === 'object' && !node.id.startsWith('missing:')) || kind === 'file'
}

export interface DiagnosticDto {
  severity: 'Error' | 'Warning' | 'Info'
  message: string
  path: string | null
}

export interface UndoRedoOutcome {
  tree: WireValue
  can_undo: boolean
  can_redo: boolean
}

// Mirrors crates/project/src/settings.rs's `ForgeSettings`.
export interface ForgeSettings {
  designer_install_dir: string | null
  open_projects?: string[]
  /** Path of the SSH key for tunnels (path only, never key content or passphrase). */
  ssh_key_path?: string | null
  /** macOS/Linux: trust an unknown SSH host key on the first connect. */
  ssh_accept_new_host_keys?: boolean | null
}

// Mirrors crates/project/src/catalog/sheet.rs (P8 step 3/5): the Properties panel and the Navigator.
export type PropKind = 'text' | 'bool' | 'int' | 'number' | 'enum' | 'linked' | 'reference' | 'list' | 'object'

export interface SheetRow {
  name: string
  kind: PropKind
  value?: WireValue
  display: string
  /** Present in the file; unset rows are shown italic and dimmed. */
  set: boolean
  enum_values?: string[]
  /** Model type a reference points to (`entity`, `neonView`, …). */
  reference?: string
  description?: string
  editable: boolean
  reason?: string
  /** Stored as a typed `v="…"` attribute. */
  typed: boolean
  /** Editable once the object is writable; module objects get a modification instead. */
  would_edit?: boolean
  /** Unset code property: reference of the file that will be created. */
  new_reference?: string
}

export interface SheetGroup {
  key: string
  /** Empty for the first, untitled group. */
  label: string
  rows: SheetRow[]
}

export interface PropertySheet {
  name: string
  type_label: string
  path: string
  groups: SheetGroup[]
  read_only?: string
  /** Edits of this module object are written as modifications of the project. */
  modification?: boolean
  catalog_missing: boolean
}

export interface ModificationOutcome {
  action: 'created' | 'updated' | 'unchanged' | 'removal_suggested' | 'removed'
  /** Folder below `modification/` that was written or became redundant. */
  dir?: string
}

/** Properties of a file in the Projects tree. */
export interface FileInfoDto {
  name: string
  extension: string
  size: number
  modified_ms: number | null
  path: string
}

/** Result of activating a grey Navigator entry: the path of the new element and the changed tree. */
export interface ActivateOutcome {
  path: string
  tree: UndoRedoOutcome
  modification?: ModificationOutcome
}

/** Result of Set to Default: new tree, plus what happened to the project's modification of a module object. */
export interface ResetOutcome {
  tree: UndoRedoOutcome
  modification?: ModificationOutcome
}

export interface NavNode {
  /** Technical name shown as tooltip when the label is a readable stand-in. */
  tooltip?: string
  label: string
  /** Element path for the Properties panel; absent for folders and unset bindings. */
  path?: string
  icon: string
  dimmed?: boolean
  /** Carries the object's origin label (module and version). */
  with_origin?: boolean
  children: NavNode[]
}

// Mirrors crates/project/src/project_actor.rs `SourceDto`: the raw `.aod` text of an object,
// including edits that are not saved yet.
export interface ObjectSource {
  text: string
  read_only: boolean
}

// Mirrors platform::GitCommit.
export interface GitCommit {
  hash: string
  author: string
  /** Strict ISO 8601 author date. */
  date: string
  subject: string
}

// Mirrors the `get_file_history` result; `in_repo` is false outside a Git repository.
export interface FileHistory {
  in_repo: boolean
  commits: GitCommit[]
}

// Mirrors forge_app_core::db_session. Credentials never reach the UI.
export interface SystemDbStatus {
  system: string
  status: DbStatus
  active: boolean
}

export interface DbStatus {
  connected: boolean
  tunnel_up: boolean
  database: string | null
  host: string | null
}

export interface TableDump {
  columns: string[]
  rows: (string | null)[][]
  hidden_columns: string[]
  truncated: boolean
  /** Identity of each row (the user name of the Users tab); empty for plain dumps. */
  row_keys?: string[]
}

export interface UserPropertyDto {
  id: string
  group: string
  key: string
  value: string | null
  editable: boolean
}

export interface AliasConfigTable {
  table: TableDump
  missing_required: string[]
}

export interface DeployMapping {
  table: string
  name_column: string
  content_column: string
}

export interface DeployPlanItem {
  op: 'I' | 'U' | 'D'
  key: string
  extra_files: number
  selected_by_default: boolean
}

export interface DeployPlan {
  target: string
  items: DeployPlanItem[]
  outdated: boolean
  mapping: DeployMapping
}

export interface LastDeploy {
  author: string | null
  time_ms: number | null
  designer_version: string | null
}

export interface ChangedFile {
  path: string
  changed_ms: number
}

export interface ChangedModel {
  key: string
  files: ChangedFile[]
}

// Mirrors core::system_db::DeployOverview: read-only view of the last deploy and what changed since.
export interface DeployOverview {
  target: string
  last_deploy: LastDeploy | null
  changed: ChangedModel[]
  other_files: ChangedFile[]
}

export interface DeployChangeView {
  local: string | null
  remote: string | null
}

export interface DeployOutcome {
  executed: number
  target: string
}

export interface SqlResult {
  columns: string[]
  /** `null` is SQL NULL. */
  rows: (string | null)[][]
  truncated: boolean
  elapsed_ms: number
  rows_affected?: number | null
}

export interface SchemaTable {
  schema: string
  name: string
}

// Mirrors forge_app_core::git_actions / platform::git.
export interface GitFileStatus {
  code: string
  path: string
}

export interface CompareGroup {
  folder: string
  kind: string
  reason: 'missing' | 'different'
  count: number
  example: string
}

/** The output of the built-in transpiler compared with the official output of the same project. */
export interface CompareReport {
  total: number
  identical: number
  missing: number
  different: number
  own_only: number
  percent: number
  groups: CompareGroup[]
}

export interface GitBranch {
  name: string
  is_current: boolean
}

export interface GitOverview {
  root: string
  branch: string | null
  files: GitFileStatus[]
  branches: GitBranch[]
  remote_branches: string[]
  commits: GitCommit[]
  user_name?: string | null
  user_email?: string | null
}

/** Link of the project folder to its remote repository (`origin`). */
export interface RepoLink {
  is_repo: boolean
  url: string | null
  branch: string | null
}

export interface GitOutput {
  ok: boolean
  text: string
}

// Mirrors forge_app_core::git_scm (Source Control panel).
export interface ScmFile {
  path: string
  /** Index status (M, A, D, R, C, U or a space) and work-tree status (M, D, ? or a space). */
  index: string
  worktree: string
  from: string | null
}

export interface ScmOverview {
  root: string
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: ScmFile[]
  truncated: boolean
  branches: GitBranch[]
  remote_branches: string[]
}

export type ScmDiffSide = 'unstaged' | 'staged' | 'commit'

export interface DiffContent {
  original: string
  modified: string
  binary: boolean
  too_large: boolean
}

export interface GutterHunk {
  kind: 'added' | 'modified' | 'deleted'
  start: number
  count: number
}

export interface Gutter {
  untracked: boolean
  hunks: GutterHunk[]
}

export interface CommitFile {
  status: string
  path: string
}

/** Diff tab: which file and which two versions it compares. */
export interface DiffTarget {
  root: string
  path: string
  side: ScmDiffSide
  hash?: string
}
// Mirrors crates/project/src/system_config.rs: secrets are never part of these records.
export interface AliasProp {
  name: string
  value: string
  secret: boolean
}

export interface AliasGroup {
  label: string
  props: AliasProp[]
}

export interface AliasConfigDto {
  name: string
  type_label: string
  icon: string
  jdbc_url: string | null
  groups: AliasGroup[]
}

export interface ForwardStatusDto {
  target_host: string
  target_port: number
  local_port: number
  up: boolean
}

/** An ADITO project found inside the projects folder. */
export interface WebserviceDto {
  name: string
  module: string | null
  methods: string[]
  loginTypes: string[]
  fields: number
}

export interface RestServerDto {
  host: string
  systems: string[]
}

export interface RestUserDto {
  id: string
  title: string
}

export interface RestAuthDto {
  kind: 'none' | 'basic' | 'usertoken'
  user: string
  tokenId: string
}

export interface RestRequestDto {
  url: string
  method: string
  headers: [string, string][]
  body: string | null
  auth: RestAuthDto
  insecure: boolean
  timeoutSecs?: number
}

export interface RestResponseDto {
  status: number
  reason: string
  headers: [string, string][]
  body: string
  elapsedMs: number
  size: number
  sent: string
}

export interface FoundProjectDto {
  path: string
  name: string
}

export interface TunnelRowDto {
  tunnel_host: string
  tunnel_port: number
  target_host: string
  target_port: number
  user: string
}

// Mirrors crates/project/src/problems.rs.
export interface ProblemDto {
  node_id: string
  object: string
  object_type: string
  source: 'parse' | 'validator' | 'reference'
  severity: string
  message: string
  path?: string | null
  line?: number | null
  column?: number | null
}

// Mirrors crates/project/src/problems.rs (find_usages).
export interface UsageDto {
  node_id: string
  object: string
  object_type: string
  path?: string | null
  line?: number | null
  column?: number | null
  kind: string
}

// Mirrors crates/project/src/new_object.rs.
export interface NewObjectKind {
  folder: string
  label: string
  enabled: boolean
  hint?: string | null
  needs_title: boolean
  reference_label?: string | null
  /** Types with a fixed name (the Name field is left out). */
  fixed_name?: string | null
}

// Mirrors crates/project/src/rename.rs.
export interface RenameHit {
  file: string
  line: number
  text: string
}
export interface RenamePlan {
  object: string
  new_name: string
  object_type: string
  changes: UsageDto[]
  hits: RenameHit[]
}

// Mirrors crates/project/src/project_zip.rs.
export interface ModelEntry {
  folder: string
  name: string
  files: number
  modified_secs: number
  exists: boolean
}
export interface ImportOutcome {
  imported: string[]
  skipped: string[]
}

// Mirrors crates/project/src/jdito_types.rs.
export interface JditoTypeFile {
  path: string
  content: string
}
export interface JditoTypes {
  version: string
  files: JditoTypeFile[]
}

// Mirrors crates/project/src/local_data.rs.
export interface LocalEntry {
  name: string
  is_dir: boolean
  size_bytes: number
  modified_unix: number | null
}

export interface VersionDir {
  name: string
  path: string
  size_bytes: number
  modified_unix: number | null
  days_unused: number | null
  outdated: boolean
}

export interface LiquibaseTarget {
  system: string
  host: string
  database: string
}

export interface UpdateInfo {
  version: string
  notes: string | null
  date: string | null
}

export interface LocalDataInfo {
  app_version: string
  exe_dir: string
  os: string
  arch: string
  forge_data_dir: string
  forge_settings_file: string
  forge_entries: LocalEntry[]
  designer_roaming_dir: string | null
  designer_roaming_exists: boolean
  designer_versions: VersionDir[]
  designer_install: string | null
}

// ---- Projekt-Index (Backend: crates/project-index, Events camelCase) ----
export type IndexPhase = 'queued' | 'listing' | 'reading' | 'linking' | 'ready' | 'cancelled' | 'failed'

/** Event `forge://index-progress`. */
export interface IndexProgress {
  project: string
  generation: number
  phase: IndexPhase
  done: number
  total: number
  percent: number | null
  currentFile: string | null
  message: string | null
}

export type ChangeReason = 'watcher' | 'git' | 'flood' | 'rescan' | 'focus' | 'modules'

export interface IndexChangedFile {
  path: string
  kind: 'added' | 'modified' | 'removed'
  own: boolean
  objectType: string | null
  name: string | null
}

/** Event `forge://project-changed`. */
export interface ProjectChanged {
  project: string
  generation: number
  reason: ChangeReason
  changed: IndexChangedFile[]
  truncated: boolean
  affected: string[]
  modulesChanged: boolean
  full: boolean
  ownOnly: boolean
}

export interface IndexStatus {
  project: string
  generation: number
  phase: IndexPhase
  done: number
  total: number
  files: number
  objects: number
  references: number
  lastBuildMs: number | null
}

export interface VerifyOutcome {
  changed: number
  durationMs: number
}
