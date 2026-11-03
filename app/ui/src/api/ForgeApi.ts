import type { ActivateOutcome, FileInfoDto, CommitFile, DiffContent, Gutter, ScmDiffSide, ScmOverview, GitCommit, NewObjectKind, RenamePlan, ModelEntry, ImportOutcome, JditoTypes, ForwardStatusDto, UsageDto, LocalDataInfo, UpdateInfo, LiquibaseTarget, ProblemDto, AliasConfigDto, AliasConfigTable, DeployChangeView, DeployMapping, DeployOutcome, DeployPlan, TableDump, TunnelRowDto, DbStatus, SystemDbStatus, DiagnosticDto, FileHistory, ForgeSettings, GitOutput, GitOverview, SchemaTable, SqlResult, ModificationOutcome, ResetOutcome, NavNode, ObjectSource, PropertySheet, TreeNode, UndoRedoOutcome, WireValue } from '../wire/types'

// The frontend's one seam onto the generic Tauri command surface (architecture.md §6: "Commands
// sind generisch ... nicht pro Editor-Typ dupliziert"). Every editor component talks to this
// interface, never to `@tauri-apps/api` directly - that is what lets component tests run against
// `createMockForgeApi` (src/test/mockApi.ts) with zero real Tauri runtime, and is the seam a
// later P4 agent's own editor components reuse unchanged.
export interface ForgeApi {
  // Scans one project and returns its root node (a one-element list, so several open projects
  // simply concatenate into the forest the Projects tree shows).
  openProject(path: string): Promise<TreeNode[]>
  // Children of a node marked `lazy` (module file trees under External Libraries, `others`).
  listTreeChildren(nodeId: string): Promise<TreeNode[]>
  // The open-project list kept in Forge's settings (LAYOUT_SPEC §4.2): restored at start (only
  // folders that still exist), added to by Open Project, removed from by Close Project.
  restoreOpenProjects(): Promise<string[]>
  addOpenProject(path: string): Promise<string[]>
  removeOpenProject(path: string): Promise<string[]>
  getPropertyTree(nodeId: string): Promise<WireValue>
  setProperty(nodeId: string, path: string, value: WireValue): Promise<WireValue>
  listDiagnostics(nodeId: string): Promise<DiagnosticDto[]>
  executeAction(actionId: string, targetPath: string, params: Record<string, string>): Promise<void>
  undo(nodeId: string): Promise<UndoRedoOutcome>
  redo(nodeId: string): Promise<UndoRedoOutcome>
  save(nodeId: string): Promise<void>
  /** Save although the file changed on disk meanwhile (the old disk version is backed up first). */
  saveOverwrite(nodeId: string): Promise<void>
  /** Drops the in-memory copy so the next read of the object comes from disk. */
  reloadObject(nodeId: string): Promise<void>
  /** Open objects that changed (or vanished) on disk since they were read or saved. */
  externalChanges(nodeIds: string[]): Promise<string[]>
  /** True when project files were added, removed or edited since the previous call. */
  projectChanged(projectRoot: string): Promise<boolean>
  openLogFolder(): Promise<string>
  openBackupFolder(): Promise<string>
  /** Writes a frontend error to the log file; resolves to the log file path. */
  logClientError(message: string): Promise<string | null>
  readLinkedFile(projectRoot: string, reference: string): Promise<string>
  writeLinkedFile(projectRoot: string, reference: string, content: string): Promise<void>
  // System editor: alias configs and tunnel list of the system's export files (`$PROJECTHOME/...`
  // reference); passwords and keys are never returned.
  readAliasConfigs(projectRoot: string, reference: string): Promise<AliasConfigDto[]>
  readTunnelConfig(projectRoot: string, reference: string): Promise<TunnelRowDto[]>
  // Add / Delete Tunnel: change only that entry in the tunnel config file; the new list comes back.
  addTunnelRow(projectRoot: string, reference: string, row: TunnelRowDto): Promise<TunnelRowDto[]>
  deleteTunnelRow(projectRoot: string, reference: string, index: number): Promise<TunnelRowDto[]>
  // P7 (project-open-dialog): the native folder-picker seam. `null` means the user cancelled the
  // dialog, which is not an error - callers must treat it as "nothing changed".
  // `title` lets other folder choices (e.g. the Designer installation in Tools > Options) reuse
  // the same native dialog with a fitting caption.
  pickProjectFolder(title?: string): Promise<string | null>
  // P7: "recently opened project" hint - purely a suggestion for the empty state, never
  // auto-loaded (see App.tsx).
  getRecentProject(): Promise<string | null>
  setRecentProject(path: string): Promise<void>
  // P8 Tools > Options: Forge's own settings, stored in its app data folder.
  getSettings(): Promise<ForgeSettings>
  setSettings(settings: ForgeSettings): Promise<void>
  // The Designer installation automatic discovery would use, `null` if none was found.
  detectDesignerInstall(): Promise<string | null>
  // P8 status bar: checked-out Git branch of the open project, `null` outside a repository.
  getCurrentBranch(projectRoot: string): Promise<string | null>
  // P8 step 3: the Properties panel of an object (`path` '$') or of one element inside it, with
  // all properties the installed Designer knows for it, grouped and described.
  getPropertySheet(nodeId: string, path: string): Promise<PropertySheet>
  // Writes one property, also one that is not in the file yet; `typed` = `v="…"` attribute form.
  setSheetProperty(nodeId: string, path: string, name: string, value: WireValue, typed: boolean): Promise<UndoRedoOutcome>
  // Clearing a value removes the property from the file again (undoable).
  removeSheetProperty(nodeId: string, path: string, name: string): Promise<UndoRedoOutcome>
  /** Set to Default: removes a property (module objects: the project's modification of it). */
  resetSheetProperty(nodeId: string, path: string, name: string): Promise<ResetOutcome>
  /** Set to Default of an element such as a field mapping of the Navigator. */
  resetSheetElement(nodeId: string, path: string): Promise<ResetOutcome>
  // Files of the Projects tree: properties, paste (copy or cut), rename, delete, open with the system's program.
  fileInfo(path: string): Promise<FileInfoDto>
  filePaste(projectRoot: string, source: string, destDir: string, cut: boolean): Promise<string>
  fileRename(projectRoot: string, path: string, newName: string): Promise<string>
  fileDelete(projectRoot: string, path: string): Promise<void>
  openInSystem(path: string): Promise<void>
  /** NodeJS menu: one npm command in the project folder; the exit code. Output arrives as events. */
  npmRun(projectRoot: string, action: string, confirmed: boolean): Promise<number>
  /** Activates a grey Navigator entry: creates its (empty) definition; module objects: as modification. */
  activateMapping(nodeId: string, path: string): Promise<ActivateOutcome>
  // Where the project's own objects point to one object (Find Usages, Safely Delete); read-only.
  findUsages(projectRoot: string, objectType: string, name: string): Promise<UsageDto[]>
  // Local data folders (Help > Local Data, Janitor list); read-only.
  localDataInfo(thresholdDays: number): Promise<LocalDataInfo>
  /** Database a Liquibase update of this alias would change; shown in the confirmation. */
  liquibaseTarget(system: string | null, alias: string): Promise<LiquibaseTarget>
  /** Runs the changelogs of `.liquibase/<alias>` against the alias database; output goes to Output > Build. */
  liquibaseUpdate(system: string | null, alias: string, projectRoot: string): Promise<string>
  /** Newer release in the private update repository, or null when this version is current. */
  checkForUpdate(): Promise<UpdateInfo | null>
  /** Downloads and installs the newer release, then restarts the app. */
  installUpdate(): Promise<void>
  // Read-only scan of all objects of a project: parse errors, validator findings, dangling references.
  scanProblems(projectRoot: string): Promise<ProblemDto[]>
  // Create Modification: edits of a module object are written as modifications of the project.
  enableModification(nodeId: string, projectRoot: string): Promise<void>
  setModificationProperty(nodeId: string, path: string, name: string, value: WireValue, typed: boolean, kind: string): Promise<ModificationOutcome>
  setModificationScript(nodeId: string, path: string, name: string, content: string): Promise<ModificationOutcome>
  // Deletes a modification that became redundant; only after the user confirmed.
  discardModification(projectRoot: string, dir: string): Promise<void>
  // P8 step 5: the Navigator outline of an object.
  getNavigator(nodeId: string): Promise<NavNode[]>
  // P8 step 4, Source tab: the raw `.aod` text, and replacing it as a whole. The backend only
  // accepts well-formed text that `aod-io` re-emits byte for byte, and records one undo step.
  getObjectSource(nodeId: string): Promise<ObjectSource>
  setObjectSource(nodeId: string, text: string): Promise<UndoRedoOutcome>
  // P8 step 4, History tab: read-only `git log` of one file.
  getFileHistory(path: string): Promise<FileHistory>
  // Services tab. Native file picker for the export files and the SSH key; `null` on cancel.
  pickFile(title: string, label: string, extensions: string[]): Promise<string | null>
  // Opens tunnel and system-DB connection from the two chosen export files; the credentials are
  // read in the backend at that moment and never come back to the UI.
  // `tunnelPassword` switches the tunnel to basic auth (appendix E); it is held in memory only.
  dbConnect(tunnelConfig: string, serverConfig: string, keyFile: string | null, tunnelPassword?: string | null, system?: string | null): Promise<DbStatus>
  // Per-row SSH port forwards of the tunnel config editor; key file or password stay in memory only.
  tunnelConnect(row: TunnelRowDto, keyFile: string | null, tunnelPassword: string | null): Promise<ForwardStatusDto>
  tunnelDisconnect(targetHost: string, targetPort: number): Promise<void>
  tunnelDisconnectAll(): Promise<void>
  tunnelList(): Promise<ForwardStatusDto[]>
  // Without a system name these act on the active session; with one, only on that system's session.
  // Ends the running official transpiler (the caller has asked first); false when none runs.
  cancelBuild(): Promise<boolean>
  // Stops a connect that still waits for the tunnel or the database.
  dbCancelConnect(): Promise<void>
  // Read-only session to another database alias of a system (Data_alias ...) for the database browser.
  dbConnectAlias(system: string, alias: string, tunnelConfig: string): Promise<DbStatus>
  // Is the forward to this system's database open? Looked up from its tunnel and server config.
  systemTunnelState(projectRoot: string, tunnelRef: string, serverRef: string): Promise<{ db_tunnel_up: boolean; target: string | null; problem: string | null }>
  dbDisconnect(system?: string | null): Promise<void>
  dbStatus(system?: string | null): Promise<DbStatus>
  // One open session per system; the active one answers queries and deploys.
  dbSystems(): Promise<SystemDbStatus[]>
  dbActivate(system: string): Promise<boolean>
  // Read-only unless `allowWrite` is set, which the UI does only after the user switched writing
  // on and confirmed the statement.
  dbQuery(sql: string, allowWrite: boolean): Promise<SqlResult>
  dbSchema(): Promise<SchemaTable[]>
  // System-DB reads for the system editor; credential columns are removed in the backend.
  systemUsers(): Promise<TableDump>
  systemAliasConfigs(): Promise<AliasConfigTable>
  // Alias config list of the system editor (one entry per alias, secrets never included).
  systemAliasList(serverIds: string[]): Promise<AliasConfigDto[]>
  systemServerIds(configReference: string, systemName: string): Promise<string[]>
  // Deploy into ASYS_SYSTEM: `deployPlan` and `deployShowChanges` only read; `deployExecute` writes
  // in one transaction and only with `confirmed` set by the user's explicit click.
  deployPlan(projectRoot: string, force: boolean, mapping: DeployMapping | null): Promise<DeployPlan>
  deployShowChanges(projectRoot: string, key: string, mapping: DeployMapping | null): Promise<DeployChangeView>
  deployExecute(projectRoot: string, keys: string[], force: boolean, mapping: DeployMapping | null, confirmed: boolean): Promise<DeployOutcome>
  // Tree context menu: copies an object under a new name into a project root (returns the new
  // object file) and deletes an object folder; both refuse anything but the standard layout.
  copyObject(source: string, destRoot: string, newName: string): Promise<string>
  deleteObject(source: string): Promise<void>
  // File > New: types, name check (null = free) and creation of one object (returns its model file).
  newObjectKinds(): Promise<NewObjectKind[]>
  validateNewName(projectRoot: string, folder: string, name: string): Promise<string | null>
  createObject(projectRoot: string, folder: string, name: string, title: string | null, reference: string | null): Promise<string>
  // Rename: the preview only reads; renameObject runs after the user confirmed it.
  renamePlan(projectRoot: string, source: string, newName: string): Promise<RenamePlan>
  renameObject(projectRoot: string, source: string, newName: string): Promise<string>
  // Export / Import Project (zip). Nothing is overwritten unless listed in `overwrite`.
  listProjectModels(projectRoot: string): Promise<ModelEntry[]>
  exportProjectZip(projectRoot: string, models: [string, string][], target: string): Promise<number>
  inspectProjectZip(projectRoot: string, zipPath: string): Promise<ModelEntry[]>
  importProjectZip(projectRoot: string, zipPath: string, selected: [string, string][], overwrite: [string, string][]): Promise<ImportOutcome>
  pickSaveFile(title: string, defaultName: string, label: string, extensions: string[]): Promise<string | null>
  // Code editor: JDito type definitions from the project's node_modules (null when not installed).
  readJditoTypes(projectRoot: string): Promise<JditoTypes | null>
  // Team menu (basic Git). Every call except `gitOverview` is the result of one confirming click.
  gitOverview(projectRoot: string): Promise<GitOverview>
  gitCommit(projectRoot: string, message: string, paths: string[]): Promise<GitOutput>
  gitPull(projectRoot: string): Promise<GitOutput>
  gitPush(projectRoot: string): Promise<GitOutput>
  /** Local commits that are not on the remote yet, newest first. */
  gitUnpushed(projectRoot: string): Promise<GitCommit[]>
  /** Commits on the remote that a pull would bring in (fetches first). */
  gitIncoming(projectRoot: string): Promise<GitCommit[]>
  /** Pushes the current branch up to this unpushed commit. */
  gitPushTo(projectRoot: string, hash: string): Promise<GitOutput>
  gitCheckout(projectRoot: string, branch: string): Promise<GitOutput>
  gitCreateBranch(projectRoot: string, name: string, start: string | null): Promise<GitOutput>
  // Source Control panel (local Git). Every writing call is the result of one click.
  scmStatus(projectRoot: string): Promise<ScmOverview>
  scmStage(projectRoot: string, paths: string[]): Promise<GitOutput>
  scmStageAll(projectRoot: string): Promise<GitOutput>
  scmUnstage(projectRoot: string, paths: string[]): Promise<GitOutput>
  scmDiscard(projectRoot: string, paths: string[]): Promise<GitOutput>
  scmCommit(projectRoot: string, message: string): Promise<GitOutput>
  scmSync(projectRoot: string): Promise<GitOutput>
  scmHistory(projectRoot: string, limit: number): Promise<GitCommit[]>
  scmCommitFiles(projectRoot: string, hash: string): Promise<CommitFile[]>
  scmDiff(projectRoot: string, path: string, side: ScmDiffSide, hash: string | null): Promise<DiffContent>
  scmGutter(projectRoot: string, file: string): Promise<Gutter>
}
