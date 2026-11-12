import { invoke as rawInvoke } from '@tauri-apps/api/core'
import { callSite } from '../core/errorLog'

/**
 * Alle Tauri-Aufrufe laufen hierüber. Schlägt ein Befehl fehl, kommt Name und Fehlertext ins Protokoll
 * (Log-Ordner). Ohne Argumente, damit keine Geheimnisse in die Datei geraten. Bei `plugin_call` loggt das Backend zusätzlich den Fehler mit Argumenten; hier kommt der Aufrufer (Datei:Zeile) dazu.
 */
function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  const site = callSite() // Aufrufer jetzt merken: nach dem await ist der Stapel weg
  const nl = String.fromCharCode(10)
  const report = (text: string) => void rawInvoke('log_client_error', { message: text + nl + 'aufgerufen von:' + nl + site }).catch(() => {})
  // Ein leerer Projektordner ist immer ein Fehler des Aufrufers: sofort und mit Aufrufer melden, statt Windows-Fehler 123 aus dem Prozessstart.
  if (command === 'plugin_call') {
    const inner = (args?.args ?? {}) as Record<string, unknown>
    if ('projectRoot' in inner && (typeof inner.projectRoot !== 'string' || inner.projectRoot.trim() === '')) {
      const message = `${String(args?.plugin)}.${String(args?.command)}: kein Projektordner übergeben (projectRoot ist leer)`
      report(`command plugin_call ${message}`)
      return Promise.reject(message)
    }
  }
  return rawInvoke<T>(command, args).catch((e: unknown) => {
    if (command !== 'log_client_error') {
      const what = command === 'plugin_call' ? `plugin_call ${String(args?.plugin)}.${String(args?.command)}` : command
      report(`command ${what} failed: ${typeof e === 'string' ? e : e instanceof Error ? e.message : JSON.stringify(e)}`)
    }
    throw e
  })
}

/** Meldet dem Backend die Zeitzone des Nutzers, damit das Protokoll Ortszeit zeigt (JS: Minuten westlich von UTC, daher negiert). */
export function syncLogTimezone(): void {
  void rawInvoke('set_log_timezone', { offsetMinutes: -new Date().getTimezoneOffset() }).catch(() => {})
}

/** Git ist ein Plugin: alle Aufrufe laufen über den einen Befehl `plugin_call`. */
const gitCall = <T,>(command: string, args: Record<string, unknown>) =>
  invoke<T>('plugin_call', { plugin: 'git', command, args })

import type { ForgeApi } from './ForgeApi'
import type { CompareReport, ActivateOutcome, FileInfoDto, CommitFile, DiffContent, Gutter, ScmDiffSide, ScmOverview, GitCommit, NewObjectKind, RenamePlan, ModelEntry, ImportOutcome, JditoTypes, ForwardStatusDto, UsageDto, LocalDataInfo, UpdateInfo, LiquibaseTarget, ProblemDto, AliasConfigDto, AliasConfigTable, DeployChangeView, DeployOutcome, DeployOverview, DeployPlan, TableDump, UserPropertyDto, TunnelRowDto, FoundProjectDto, WebserviceDto, RestUserDto, RestResponseDto, DbStatus, SystemDbStatus, DiagnosticDto, FileHistory, ForgeSettings, GitOutput, GitOverview, SchemaTable, SqlResult, ModificationOutcome, ResetOutcome, NavNode, ObjectSource, PropertySheet, TreeNode, UndoRedoOutcome, WireValue } from '../wire/types'

// The real implementation - a pure pass-through to the Tauri commands in
// app/src-tauri/src/lib.rs, one call each, no business logic (architecture.md §1
// "Grundregel" applies to the frontend adapter too, not just the Rust side).
export const tauriForgeApi: ForgeApi = {
  openProject: (path) => invoke<TreeNode[]>('open_project', { path }),
  listTreeChildren: (nodeId) => invoke<TreeNode[]>('list_tree_children', { nodeId }),
  restoreOpenProjects: () => invoke<string[]>('restore_open_projects'),
  listIcons: () => invoke('list_icons'),
  addOpenProject: (path) => invoke<string[]>('add_open_project', { path }),
  removeOpenProject: (path) => invoke<string[]>('remove_open_project', { path }),
  getPropertyTree: (nodeId) => invoke<WireValue>('get_property_tree', { nodeId }),
  setProperty: (nodeId, path, value) => invoke<WireValue>('set_property', { nodeId, path, value }),
  listDiagnostics: (nodeId) => invoke<DiagnosticDto[]>('list_diagnostics', { nodeId }),
  executeAction: (actionId, targetPath, params) =>
    invoke<void>('execute_action', { actionId, targetPath, params }),
  undo: (nodeId) => invoke<UndoRedoOutcome>('undo', { nodeId }),
  redo: (nodeId) => invoke<UndoRedoOutcome>('redo', { nodeId }),
  save: (nodeId) => invoke<void>('save', { nodeId }),
  saveOverwrite: (nodeId) => invoke<void>('save_overwrite', { nodeId }),
  reloadObject: (nodeId) => invoke<void>('reload_object', { nodeId }),
  externalChanges: (nodeIds) => invoke<string[]>('external_changes', { nodeIds }),
  projectChanged: (projectRoot) => invoke<boolean>('project_changed', { projectRoot }),
  openLogFolder: () => invoke<string>('open_log_folder'),
  openBackupFolder: () => invoke<string>('open_backup_folder'),
  logClientError: (message) => invoke<string | null>('log_client_error', { message }),
  readAliasConfigs: (projectRoot, reference) => invoke<AliasConfigDto[]>('plugin_call', { plugin: 'database', command: 'read_alias_configs', args: { projectRoot, reference } }),
  readTunnelConfig: (projectRoot, reference) => invoke<TunnelRowDto[]>('plugin_call', { plugin: 'ssh-tunnel', command: 'read_tunnel_config', args: { projectRoot, reference } }),
  addTunnelRow: (projectRoot, reference, row) => invoke<TunnelRowDto[]>('plugin_call', { plugin: 'ssh-tunnel', command: 'add_tunnel_row', args: { projectRoot, reference, row } }),
  deleteTunnelRow: (projectRoot, reference, index) => invoke<TunnelRowDto[]>('plugin_call', { plugin: 'ssh-tunnel', command: 'delete_tunnel_row', args: { projectRoot, reference, index } }),
  importConfigFile: (projectRoot, source) => invoke<string>('plugin_call', { plugin: 'database', command: 'import_config_file', args: { projectRoot, source } }),
  openLocalUrl: (url) => invoke<void>('open_local_url', { url }),
  listProjectFiles: (projectRoot) => invoke<string[]>('list_project_files', { projectRoot }),
  readThemeFile: (path) => invoke<string>('read_theme_file', { path }),
  readThemePack: (path) => invoke<{ name: string; text: string }[]>('read_theme_pack', { path }),
  resolveImport: (projectRoot, spec, fromFile) => invoke<string | null>('resolve_import', { projectRoot, spec, fromFile }),
  readLinkedFile: (projectRoot, reference) =>
    invoke<string>('read_linked_file', { projectRoot, reference }),
  writeLinkedFile: (projectRoot, reference, content) =>
    invoke<void>('write_linked_file', { projectRoot, reference, content }),
  pickProjectFolder: (title) => invoke<string | null>('pick_project_folder', { title: title ?? null }),
  getRecentProject: () => invoke<string | null>('get_recent_project'),
  getRecentProjects: () => invoke<string[]>('get_recent_projects'),
  findProjectsInFolder: (folder) => invoke<FoundProjectDto[]>('find_projects_in_folder', { folder }),
  restListWebservices: (projectRoot) => invoke<WebserviceDto[]>('rest_list_webservices', { projectRoot }),
  restUsers: () => invoke<RestUserDto[]>('plugin_call', { plugin: 'database', command: 'rest_users', args: {} }),
  restSend: (request) => invoke<RestResponseDto>('rest_send', { request }),
  restHasPassword: (url, user) => invoke<boolean>('rest_has_password', { url, user }),
  restSavePassword: (url, user, password) => invoke<void>('rest_save_password', { url, user, password }),
  restForgetPassword: (url, user) => invoke<void>('rest_forget_password', { url, user }),
  pickProjectFolders: (title) => invoke<string[]>('pick_project_folders', { title: title ?? null }),
  setRecentProject: (path) => invoke<void>('set_recent_project', { path }),
  getSettings: () => invoke<ForgeSettings>('get_settings'),
  setSettings: (settings) => invoke<void>('set_settings', { settings }),
  detectDesignerInstall: () => invoke<string | null>('detect_designer_install'),
  pluginList: () => invoke<{ id: string; name: string; available: boolean }[]>('plugin_list'),
  getCurrentBranch: (projectRoot) => gitCall<string | null>('get_current_branch', { projectRoot }),
  getPropertySheet: (nodeId, path) => invoke<PropertySheet>('get_property_sheet', { nodeId, path }),
  setSheetProperty: (nodeId, path, name, value, typed) =>
    invoke<UndoRedoOutcome>('set_sheet_property', { nodeId, path, name, value, typed }),
  removeSheetProperty: (nodeId, path, name) => invoke<UndoRedoOutcome>('remove_sheet_property', { nodeId, path, name }),
  resetSheetProperty: (nodeId, path, name) => invoke<ResetOutcome>('reset_sheet_property', { nodeId, path, name }),
  resetSheetElement: (nodeId, path) => invoke<ResetOutcome>('reset_sheet_element', { nodeId, path }),
  fileInfo: (path) => invoke<FileInfoDto>('file_info', { path }),
  filePaste: (projectRoot, source, destDir, cut) => invoke<string>('file_paste', { projectRoot, source, destDir, cut }),
  fileRename: (projectRoot, path, newName) => invoke<string>('file_rename', { projectRoot, path, newName }),
  fileDelete: (projectRoot, path) => invoke<void>('file_delete', { projectRoot, path }),
  openInSystem: (path) => invoke<void>('open_in_system', { path }),
  npmRun: (projectRoot, action, confirmed) => invoke<number>('npm_run', { projectRoot, action, confirmed }),
  activateMapping: (nodeId, path) => invoke<ActivateOutcome>('activate_mapping', { nodeId, path }),
  findUsages: (projectRoot, objectType, name) => invoke<UsageDto[]>('find_usages', { projectRoot, objectType, name }),
  localDataInfo: (thresholdDays) => invoke<LocalDataInfo>('local_data_info', { thresholdDays }),
  liquibaseTarget: (system, alias, connectionAlias) => invoke<LiquibaseTarget>('plugin_call', { plugin: 'liquibase', command: 'liquibase_target', args: { system, alias, connectionAlias: connectionAlias ?? null } }),
  liquibaseConnections: (system) => invoke('plugin_call', { plugin: 'liquibase', command: 'liquibase_connections', args: { system } }),
  liquibaseUpdate: (system, alias, projectRoot, connectionAlias, useDist) => invoke<string>('plugin_call', { plugin: 'liquibase', command: 'liquibase_update', args: { system, alias, projectRoot, connectionAlias: connectionAlias ?? null, useDist: useDist ?? false } }),
  liquibasePlan: (projectRoot, alias) => invoke('plugin_call', { plugin: 'liquibase', command: 'liquibase_plan', args: { projectRoot, alias } }),
  checkForUpdate: () => invoke<UpdateInfo | null>('check_for_update'),
  installUpdate: () => invoke<void>('install_update'),
  scanProblems: (projectRoot) => invoke<ProblemDto[]>('scan_problems', { projectRoot }),
  enableModification: (nodeId, projectRoot) => invoke<void>('enable_modification', { nodeId, projectRoot }),
  setModificationProperty: (nodeId, path, name, value, typed, kind) =>
    invoke<ModificationOutcome>('set_modification_property', { nodeId, path, name, value, typed, kind }),
  setModificationScript: (nodeId, path, name, content) =>
    invoke<ModificationOutcome>('set_modification_script', { nodeId, path, name, content }),
  discardModification: (projectRoot, dir) => invoke<void>('discard_modification', { projectRoot, dir }),
  getNavigator: (nodeId) => invoke<NavNode[]>('get_navigator', { nodeId }),
  getObjectSource: (nodeId) => invoke<ObjectSource>('get_object_source', { nodeId }),
  setObjectSource: (nodeId, text) => invoke<UndoRedoOutcome>('set_object_source', { nodeId, text }),
  getFileHistory: (path) => gitCall<FileHistory>('get_file_history', { path }),
  tunnelConnect: (row, keyFile, tunnelPassword) => invoke<ForwardStatusDto>('plugin_call', { plugin: 'ssh-tunnel', command: 'tunnel_connect', args: { row, keyFile, tunnelPassword } }),
  tunnelDisconnect: (targetHost, targetPort) => invoke<void>('plugin_call', { plugin: 'ssh-tunnel', command: 'tunnel_disconnect', args: { targetHost, targetPort } }),
  tunnelDisconnectAll: () => invoke<void>('plugin_call', { plugin: 'ssh-tunnel', command: 'tunnel_disconnect_all', args: {} }),
  tunnelList: () => invoke<ForwardStatusDto[]>('plugin_call', { plugin: 'ssh-tunnel', command: 'tunnel_list', args: {} }),
  pickFile: (title, label, extensions) => invoke<string | null>('pick_file', { title, label, extensions }),
  dbConnect: (tunnelConfig, serverConfig, keyFile, tunnelPassword, system) => invoke<DbStatus>('plugin_call', { plugin: 'database', command: 'db_connect', args: { tunnelConfig, serverConfig, keyFile, tunnelPassword: tunnelPassword ?? null, system: system ?? null } }),
  systemTunnelState: (projectRoot, tunnelRef, serverRef) => invoke('plugin_call', { plugin: 'database', command: 'system_tunnel_state', args: { projectRoot, tunnelRef, serverRef } }),
  dbConnectAlias: (system, alias, tunnelConfig, serverIds) => invoke<DbStatus>('plugin_call', { plugin: 'database', command: 'db_connect_alias', args: { system, alias, tunnelConfig, serverIds } }),
  dbCancelConnect: () => invoke<void>('plugin_call', { plugin: 'database', command: 'db_cancel_connect', args: {} }),
  cancelBuild: () => invoke<boolean>('cancel_build'),
  dbDisconnect: (system) => invoke<void>('plugin_call', { plugin: 'database', command: 'db_disconnect', args: { system: system ?? null } }),
  dbStatus: (system) => invoke<DbStatus>('plugin_call', { plugin: 'database', command: 'db_status', args: { system: system ?? null } }),
  dbSystems: () => invoke<SystemDbStatus[]>('plugin_call', { plugin: 'database', command: 'db_systems', args: {} }),
  dbActivate: (system) => invoke<boolean>('plugin_call', { plugin: 'database', command: 'db_activate', args: { system } }),
  dbQuery: (sql, allowWrite) => invoke<SqlResult>('plugin_call', { plugin: 'database', command: 'db_query', args: { sql, allowWrite } }),
  dbSchema: () => invoke<SchemaTable[]>('plugin_call', { plugin: 'database', command: 'db_schema', args: {} }),
  systemUsers: () => invoke<TableDump>('plugin_call', { plugin: 'database', command: 'system_users', args: {} }),
  systemUserProperties: (user) => invoke<UserPropertyDto[]>('plugin_call', { plugin: 'database', command: 'system_user_properties', args: { user } }),
  systemAssignedRoles: () => invoke<string[]>('plugin_call', { plugin: 'database', command: 'system_assigned_roles', args: {} }),
  systemUserSetProperty: (id, value, confirmed) => invoke<void>('plugin_call', { plugin: 'database', command: 'system_user_set_property', args: { id, value, confirmed } }),
  systemUserSet: (user, key, value, confirmed) => invoke<void>('plugin_call', { plugin: 'database', command: 'system_user_set', args: { user, key, value, confirmed } }),
  systemUserSetList: (user, key, values, confirmed) => invoke<void>('plugin_call', { plugin: 'database', command: 'system_user_set_list', args: { user, key, values, confirmed } }),
  systemUserCreate: (title, confirmed) => invoke<string>('plugin_call', { plugin: 'database', command: 'system_user_create', args: { title, confirmed } }),
  systemUserDelete: (user, confirmed) => invoke<void>('plugin_call', { plugin: 'database', command: 'system_user_delete', args: { user, confirmed } }),
  systemAliasConfigs: () => invoke<AliasConfigTable>('plugin_call', { plugin: 'database', command: 'system_alias_configs', args: {} }),
  systemAliasList: (serverIds) => invoke<AliasConfigDto[]>('plugin_call', { plugin: 'database', command: 'system_alias_list', args: { serverIds } }),
  systemServerIds: (configReference, systemName) => invoke<string[]>('plugin_call', { plugin: 'database', command: 'system_server_ids', args: { configReference, systemName } }),
  deployOverview: (projectRoot) => invoke<DeployOverview>('plugin_call', { plugin: 'deploy', command: 'deploy_overview', args: { projectRoot } }),
  deployPlan: (projectRoot, force, mapping) => invoke<DeployPlan>('plugin_call', { plugin: 'deploy', command: 'deploy_plan', args: { projectRoot, force, mapping } }),
  deployShowChanges: (projectRoot, key, mapping) => invoke<DeployChangeView>('plugin_call', { plugin: 'deploy', command: 'deploy_show_changes', args: { projectRoot, key, mapping } }),
  deployExecute: (projectRoot, keys, force, mapping, confirmed) => invoke<DeployOutcome>('plugin_call', { plugin: 'deploy', command: 'deploy_execute', args: { projectRoot, keys, force, mapping, confirmed } }),
  copyObject: (source, destRoot, newName) => invoke<string>('copy_object', { source, destRoot, newName }),
  deleteObject: (source) => invoke<void>('delete_object', { source }),
  newObjectKinds: () => invoke<NewObjectKind[]>('new_object_kinds'),
  validateNewName: (projectRoot, folder, name) => invoke<string | null>('validate_new_name', { projectRoot, folder, name }),
  createObject: (projectRoot, folder, name, title, reference) => invoke<string>('create_object', { projectRoot, folder, name, title, reference }),
  renamePlan: (projectRoot, source, newName) => invoke<RenamePlan>('rename_plan', { projectRoot, source, newName }),
  renameObject: (projectRoot, source, newName) => invoke<string>('rename_object', { projectRoot, source, newName }),
  listProjectModels: (projectRoot) => invoke<ModelEntry[]>('list_project_models', { projectRoot }),
  exportProjectZip: (projectRoot, models, target) => invoke<number>('export_project_zip', { projectRoot, models, target }),
  inspectProjectZip: (projectRoot, zipPath) => invoke<ModelEntry[]>('inspect_project_zip', { projectRoot, zipPath }),
  importProjectZip: (projectRoot, zipPath, selected, overwrite) => invoke<ImportOutcome>('import_project_zip', { projectRoot, zipPath, selected, overwrite }),
  pickSaveFile: (title, defaultName, label, extensions) => invoke<string | null>('pick_save_file', { title, defaultName, label, extensions }),
  readJditoTypes: (projectRoot) => invoke<JditoTypes | null>('read_jdito_types', { projectRoot }),
  gitOverview: (projectRoot) => gitCall<GitOverview>('git_overview', { projectRoot }),
  gitCommit: (projectRoot, message, paths) => gitCall<GitOutput>('git_commit', { projectRoot, message, paths }),
  gitPull: (projectRoot) => gitCall<GitOutput>('git_pull', { projectRoot }),
  gitPush: (projectRoot) => gitCall<GitOutput>('git_push', { projectRoot }),
  gitUnpushed: (projectRoot) => gitCall<GitCommit[]>('git_unpushed', { projectRoot }),
  gitIncoming: (projectRoot) => gitCall<GitCommit[]>('git_incoming', { projectRoot }),
  gitPushTo: (projectRoot, hash) => gitCall<GitOutput>('git_push_to', { projectRoot, hash }),
  gitCheckout: (projectRoot, branch) => gitCall<GitOutput>('git_checkout', { projectRoot, branch }),
  projectClone: (url, location, name, sshKey, password) => gitCall<string>('clone_repository', { url, location, name, sshKey, password }),
  projectCreateEmpty: (location, name) => invoke<string>('project_create_empty', { location, name }),
  transpileCompare: (reference, projectRoot) => invoke<CompareReport>('transpile_compare', { reference, projectRoot }),
  gitCreateBranch: (projectRoot, name, start) => gitCall<GitOutput>('git_create_branch', { projectRoot, name, start }),
  scmStatus: (projectRoot) => gitCall<ScmOverview>('scm_status', { projectRoot }),
  scmStage: (projectRoot, paths) => gitCall<GitOutput>('scm_stage', { projectRoot, paths }),
  scmStageAll: (projectRoot) => gitCall<GitOutput>('scm_stage_all', { projectRoot }),
  scmUnstage: (projectRoot, paths) => gitCall<GitOutput>('scm_unstage', { projectRoot, paths }),
  scmDiscard: (projectRoot, paths) => gitCall<GitOutput>('scm_discard', { projectRoot, paths }),
  scmCommit: (projectRoot, message) => gitCall<GitOutput>('scm_commit', { projectRoot, message }),
  scmSync: (projectRoot) => gitCall<GitOutput>('scm_sync', { projectRoot }),
  scmHistory: (projectRoot, limit) => gitCall<GitCommit[]>('scm_history', { projectRoot, limit }),
  scmCommitFiles: (projectRoot, hash) => gitCall<CommitFile[]>('scm_commit_files', { projectRoot, hash }),
  scmDiff: (projectRoot, path, side: ScmDiffSide, hash) => gitCall<DiffContent>('scm_diff', { projectRoot, path, side, hash }),
  scmGutter: (projectRoot, file) => gitCall<Gutter>('scm_gutter', { projectRoot, file }),
}
