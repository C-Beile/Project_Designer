import { callSite } from '../core/errorLog'
import { commands } from './bindings'

/**
 * Alle Tauri-Aufrufe laufen hierüber. Schlägt ein Befehl fehl, kommt Name und Fehlertext ins Protokoll
 * (Log-Ordner). Ohne Argumente, damit keine Geheimnisse in die Datei geraten. Bei `plugin_call` loggt das Backend zusätzlich den Fehler mit Argumenten; hier kommt der Aufrufer (Datei:Zeile) dazu.
 */
function reportFailure(text: string, site: string): void {
  const nl = String.fromCharCode(10)
  void commands.logClientError(text + nl + 'aufgerufen von:' + nl + site).catch(() => {})
}

function failureText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : JSON.stringify(e)
}

/** Befehl aus `bindings.ts` (tauri-specta, typisiert) mit demselben Fehler-Protokoll wie `invoke`. */
function typed<T>(command: string, call: () => Promise<T>): Promise<T> {
  const site = callSite()
  return call().catch((e: unknown) => {
    reportFailure(`command ${command} failed: ${failureText(e)}`, site)
    throw e
  })
}

/** Plugin-Befehl über den einen Tauri-Befehl `plugin_call`; Fehler kommen mit Aufrufer ins Protokoll. */
function pluginCall<T = unknown>(plugin: string, command: string, args: Record<string, unknown>): Promise<T> {
  const site = callSite() // Aufrufer jetzt merken: nach dem await ist der Stapel weg
  // Ein leerer Projektordner ist immer ein Fehler des Aufrufers: sofort und mit Aufrufer melden, statt Windows-Fehler 123 aus dem Prozessstart.
  if ('projectRoot' in args && (typeof args.projectRoot !== 'string' || args.projectRoot.trim() === '')) {
    const message = `${plugin}.${command}: kein Projektordner übergeben (projectRoot ist leer)`
    reportFailure(`command plugin_call ${message}`, site)
    return Promise.reject(message)
  }
  return commands.pluginCall(plugin, command, args).catch((e: unknown) => {
    reportFailure(`command plugin_call ${plugin}.${command} failed: ${failureText(e)}`, site)
    throw e
  }) as Promise<T>
}

/** Meldet dem Backend die Zeitzone des Nutzers, damit das Protokoll Ortszeit zeigt (JS: Minuten westlich von UTC, daher negiert). */
export function syncLogTimezone(): void {
  void commands.setLogTimezone(-new Date().getTimezoneOffset()).catch(() => {})
}

/** Git ist ein Plugin: alle Aufrufe laufen über den einen Befehl `plugin_call`. */
const gitCall = <T,>(command: string, args: Record<string, unknown>) =>
  pluginCall<T>('git', command, args)

/** Git-Aufruf mit Netzwerk: bei fehlender Anmeldung fragt das Git-Plugin den Benutzer und wiederholt ihn einmal (`api/gitAuth.ts`). */
const gitNetCall = <T,>(command: string, projectRoot: string, args: Record<string, unknown> = {}) =>
  withGitAuth(() => gitCall<T>(command, { projectRoot, ...args }), async () => ({
    root: projectRoot,
    url: await gitCall<RepoLink>('git_repo_link', { projectRoot }).then((l) => l.url).catch(() => null),
    login: async (user, password) => {
      await gitCall<string>('git_login', { projectRoot, user, password })
    },
  }))

import { withGitAuth } from './gitAuth'
import { withCheckoutChoice } from './gitCheckout'
import type { ForgeApi } from './ForgeApi'
import type { CommitFile, DiffContent, Gutter, ScmDiffSide, ScmOverview, GitCommit, ForwardStatusDto, SshKeyInfoDto, LoopbackStatusDto, LiquibaseTarget, AliasConfigDto, AliasConfigTable, DeployChangeView, DeployOutcome, DeployOverview, DeployPlan, TableDump, UserPropertyDto, TunnelRowDto, RestUserDto, DbStatus, SystemDbStatus, FileHistory, GitOutput, GitOverview, RepoLink, SchemaTable, SqlResult } from '../wire/types'

// The real implementation - a pure pass-through to the Tauri commands in
// app/src-tauri/src/lib.rs, one call each, no business logic (architecture.md §1
// "Grundregel" applies to the frontend adapter too, not just the Rust side).
export const tauriForgeApi: ForgeApi = {
  openProject: (path) => typed('open_project', () => commands.openProject(path)),
  listTreeChildren: (nodeId) => typed('list_tree_children', () => commands.listTreeChildren(nodeId)),
  restoreOpenProjects: () => typed('restore_open_projects', () => commands.restoreOpenProjects()),
  listIcons: () => typed('list_icons', () => commands.listIcons()),
  addOpenProject: (path) => typed('add_open_project', () => commands.addOpenProject(path)),
  removeOpenProject: (path) => typed('remove_open_project', () => commands.removeOpenProject(path)),
  getPropertyTree: (nodeId) => typed('get_property_tree', () => commands.getPropertyTree(nodeId)),
  setProperty: (nodeId, path, value) => typed('set_property', () => commands.setProperty(nodeId, path, value)),
  listDiagnostics: (nodeId) => typed('list_diagnostics', () => commands.listDiagnostics(nodeId)),
  executeAction: (actionId, targetPath, params) =>
    typed('execute_action', () => commands.executeAction(actionId, targetPath, params)).then(() => undefined),
  undo: (nodeId) => typed('undo', () => commands.undo(nodeId)),
  redo: (nodeId) => typed('redo', () => commands.redo(nodeId)),
  save: (nodeId) => typed('save', () => commands.save(nodeId)).then(() => undefined),
  saveOverwrite: (nodeId) => typed('save_overwrite', () => commands.saveOverwrite(nodeId)).then(() => undefined),
  reloadObject: (nodeId) => typed('reload_object', () => commands.reloadObject(nodeId)).then(() => undefined),
  externalChanges: (nodeIds) => typed('external_changes', () => commands.externalChanges(nodeIds)),
  indexStatus: (projectRoot) => typed('index_status', () => commands.indexStatus(projectRoot)),
  indexVerify: (projectRoot) => typed('index_verify', () => commands.indexVerify(projectRoot)),
  indexRebuild: (projectRoot) => typed('index_rebuild', () => commands.indexRebuild(projectRoot)).then(() => undefined),
  indexDump: (projectRoot) => typed('index_dump', () => commands.indexDump(projectRoot)),
  openLogFolder: () => typed('open_log_folder', () => commands.openLogFolder()),
  userThemes: () => typed('user_themes_list', () => commands.userThemesList()),
  saveUserTheme: async (file, text) => void (await typed('user_theme_write', () => commands.userThemeWrite(file, text))),
  deleteUserTheme: async (file) => void (await typed('user_theme_delete', () => commands.userThemeDelete(file))),
  openUserThemesFolder: () => typed('user_themes_open_folder', () => commands.userThemesOpenFolder()),
  openBackupFolder: () => typed('open_backup_folder', () => commands.openBackupFolder()),
  logClientError: (message) => commands.logClientError(message),
  readAliasConfigs: (projectRoot, reference) => pluginCall<AliasConfigDto[]>('database', 'read_alias_configs', { projectRoot, reference }),
  readTunnelConfig: (projectRoot, reference) => pluginCall<TunnelRowDto[]>('ssh-tunnel', 'read_tunnel_config', { projectRoot, reference }),
  addTunnelRow: (projectRoot, reference, row) => pluginCall<TunnelRowDto[]>('ssh-tunnel', 'add_tunnel_row', { projectRoot, reference, row }),
  deleteTunnelRow: (projectRoot, reference, index) => pluginCall<TunnelRowDto[]>('ssh-tunnel', 'delete_tunnel_row', { projectRoot, reference, index }),
  importConfigFile: (projectRoot, source) => pluginCall<string>('database', 'import_config_file', { projectRoot, source }),
  openLocalUrl: async (url) => void (await typed('open_local_url', () => commands.openLocalUrl(url))),
  listProjectFiles: (projectRoot) => typed('list_project_files', () => commands.listProjectFiles(projectRoot)),
  readThemeFile: (path) => typed('read_theme_file', () => commands.readThemeFile(path)),
  readThemePack: (path) => typed('read_theme_pack', () => commands.readThemePack(path)),
  resolveImport: (projectRoot, spec, fromFile) => typed('resolve_import', () => commands.resolveImport(projectRoot, spec, fromFile)),
  readLinkedFile: (projectRoot, reference) =>
    typed('read_linked_file', () => commands.readLinkedFile(projectRoot, reference)),
  writeLinkedFile: (projectRoot, reference, content) =>
    typed('write_linked_file', () => commands.writeLinkedFile(projectRoot, reference, content)).then(() => undefined),
  pickProjectFolder: (title) => typed('pick_project_folder', () => commands.pickProjectFolder(title ?? null)),
  getRecentProject: () => typed('get_recent_project', () => commands.getRecentProject()),
  getRecentProjects: () => typed('get_recent_projects', () => commands.getRecentProjects()),
  findProjectsInFolder: (folder) => typed('find_projects_in_folder', () => commands.findProjectsInFolder(folder)),
  restListWebservices: (projectRoot) => typed('rest_list_webservices', () => commands.restListWebservices(projectRoot)),
  restUsers: () => pluginCall<RestUserDto[]>('database', 'rest_users', {}),
  restSend: (request) => typed('rest_send', () => commands.restSend(request)),
  restHasPassword: (url, user) => typed('rest_has_password', () => commands.restHasPassword(url, user)),
  restSavePassword: (url, user, password) => typed('rest_save_password', () => commands.restSavePassword(url, user, password)).then(() => undefined),
  restForgetPassword: (url, user) => typed('rest_forget_password', () => commands.restForgetPassword(url, user)).then(() => undefined),
  pickProjectFolders: (title) => typed('pick_project_folders', () => commands.pickProjectFolders(title ?? null)),
  setRecentProject: (path) => typed('set_recent_project', () => commands.setRecentProject(path)).then(() => undefined),
  getSettings: () => typed('get_settings', () => commands.getSettings()),
  configGet: () => typed('config_get', () => commands.configGet()) as Promise<Record<string, unknown>>,
  configSet: async (path, value) => {
    await typed('config_set', () => commands.configSet(path, value)).then(() => undefined)
  },
  setSettings: (settings) => typed('set_settings', () => commands.setSettings(settings)).then(() => undefined),
  detectDesignerInstall: () => typed('detect_designer_install', () => commands.detectDesignerInstall()),
  pluginList: () => typed('plugin_list', () => commands.pluginList()),
  getCurrentBranch: (projectRoot) => gitCall<string | null>('get_current_branch', { projectRoot }),
  getPropertySheet: (nodeId, path) => typed('get_property_sheet', () => commands.getPropertySheet(nodeId, path)),
  setSheetProperty: (nodeId, path, name, value, asTyped) =>
    typed('set_sheet_property', () => commands.setSheetProperty(nodeId, path, name, value, asTyped)),
  removeSheetProperty: (nodeId, path, name) => typed('remove_sheet_property', () => commands.removeSheetProperty(nodeId, path, name)),
  resetSheetProperty: (nodeId, path, name) => typed('reset_sheet_property', () => commands.resetSheetProperty(nodeId, path, name)),
  resetSheetElement: (nodeId, path) => typed('reset_sheet_element', () => commands.resetSheetElement(nodeId, path)),
  fileInfo: (path) => typed('file_info', () => commands.fileInfo(path)),
  filePaste: (projectRoot, source, destDir, cut) => typed('file_paste', () => commands.filePaste(projectRoot, source, destDir, cut)),
  fileRename: (projectRoot, path, newName) => typed('file_rename', () => commands.fileRename(projectRoot, path, newName)),
  fileDelete: (projectRoot, path) => typed('file_delete', () => commands.fileDelete(projectRoot, path)).then(() => undefined),
  openInSystem: (path) => typed('open_in_system', () => commands.openInSystem(path)).then(() => undefined),
  npmRun: (projectRoot, action, confirmed) => typed('npm_run', () => commands.npmRun(projectRoot, action, confirmed)),
  activateMapping: (nodeId, path) => typed('activate_mapping', () => commands.activateMapping(nodeId, path)),
  findUsages: (projectRoot, objectType, name) => typed('find_usages', () => commands.findUsages(projectRoot, objectType, name)),
  localDataInfo: (thresholdDays) => typed('local_data_info', () => commands.localDataInfo(thresholdDays)),
  liquibaseTarget: (system, alias, connectionAlias) => pluginCall<LiquibaseTarget>('liquibase', 'liquibase_target', { system, alias, connectionAlias: connectionAlias ?? null }),
  liquibaseConnections: (system) => pluginCall('liquibase', 'liquibase_connections', { system }),
  liquibaseUpdate: (system, alias, projectRoot, connectionAlias, useDist) => pluginCall<string>('liquibase', 'liquibase_update', { system, alias, projectRoot, connectionAlias: connectionAlias ?? null, useDist: useDist ?? false }),
  liquibasePlan: (projectRoot, alias) => pluginCall('liquibase', 'liquibase_plan', { projectRoot, alias }),
  checkForUpdate: () => typed('check_for_update', () => commands.checkForUpdate()),
  installUpdate: () => typed('install_update', () => commands.installUpdate()).then(() => undefined),
  scanProblems: (projectRoot) => typed('scan_problems', () => commands.scanProblems(projectRoot)),
  enableModification: (nodeId, projectRoot) => typed('enable_modification', () => commands.enableModification(nodeId, projectRoot)).then(() => undefined),
  setModificationProperty: (nodeId, path, name, value, asTyped, kind) =>
    typed('set_modification_property', () => commands.setModificationProperty(nodeId, path, name, value, asTyped, kind)),
  setModificationScript: (nodeId, path, name, content) =>
    typed('set_modification_script', () => commands.setModificationScript(nodeId, path, name, content)),
  discardModification: (projectRoot, dir) => typed('discard_modification', () => commands.discardModification(projectRoot, dir)).then(() => undefined),
  getNavigator: (nodeId) => typed('get_navigator', () => commands.getNavigator(nodeId)),
  getObjectSource: (nodeId) => typed('get_object_source', () => commands.getObjectSource(nodeId)),
  setObjectSource: (nodeId, text) => typed('set_object_source', () => commands.setObjectSource(nodeId, text)),
  getFileHistory: (path) => gitCall<FileHistory>('get_file_history', { path }),
  tunnelConnect: (row, keyFile, tunnelPassword) => pluginCall<ForwardStatusDto>('ssh-tunnel', 'tunnel_connect', { row, keyFile, tunnelPassword }),
  tunnelDisconnect: (targetHost, targetPort) => pluginCall<void>('ssh-tunnel', 'tunnel_disconnect', { targetHost, targetPort }),
  tunnelDisconnectAll: () => pluginCall<void>('ssh-tunnel', 'tunnel_disconnect_all', {}),
  tunnelList: () => pluginCall<ForwardStatusDto[]>('ssh-tunnel', 'tunnel_list', {}),
  sshKeyInspect: (path) => pluginCall<SshKeyInfoDto>('ssh-tunnel', 'key_inspect', { path }),
  sshKeyUnlock: (path, passphrase) => pluginCall<void>('ssh-tunnel', 'key_unlock', { path, passphrase: passphrase ?? null }),
  sshKeySavePassphrase: (path, passphrase) => pluginCall<void>('ssh-tunnel', 'key_passphrase_save', { path, passphrase }),
  sshKeyForgetPassphrase: (path) => pluginCall<void>('ssh-tunnel', 'key_passphrase_forget', { path }),
  loopbackStatus: () => pluginCall<LoopbackStatusDto>('ssh-tunnel', 'loopback_status', {}),
  loopbackSetup: () => pluginCall<LoopbackStatusDto>('ssh-tunnel', 'loopback_setup', {}),
  sshKeyHasPassphrase: (path) => pluginCall<boolean>('ssh-tunnel', 'key_passphrase_stored', { path }),
  pickFile: (title, label, extensions) => typed('pick_file', () => commands.pickFile(title ?? null, label, extensions)),
  dbConnect: (tunnelConfig, serverConfig, keyFile, tunnelPassword, system) => pluginCall<DbStatus>('database', 'db_connect', { tunnelConfig, serverConfig, keyFile, tunnelPassword: tunnelPassword ?? null, system: system ?? null }),
  systemTunnelState: (projectRoot, tunnelRef, serverRef) => pluginCall('database', 'system_tunnel_state', { projectRoot, tunnelRef, serverRef }),
  dbConnectAlias: (system, alias, tunnelConfig, serverIds) => pluginCall<DbStatus>('database', 'db_connect_alias', { system, alias, tunnelConfig, serverIds }),
  dbCancelConnect: () => pluginCall<void>('database', 'db_cancel_connect', {}),
  cancelBuild: () => typed('cancel_build', () => commands.cancelBuild()),
  dbDisconnect: (system) => pluginCall<void>('database', 'db_disconnect', { system: system ?? null }),
  dbStatus: (system) => pluginCall<DbStatus>('database', 'db_status', { system: system ?? null }),
  dbSystems: () => pluginCall<SystemDbStatus[]>('database', 'db_systems', {}),
  dbActivate: (system) => pluginCall<boolean>('database', 'db_activate', { system }),
  dbQuery: (sql, allowWrite) => pluginCall<SqlResult>('database', 'db_query', { sql, allowWrite }),
  dbSchema: () => pluginCall<SchemaTable[]>('database', 'db_schema', {}),
  systemUsers: () => pluginCall<TableDump>('database', 'system_users', {}),
  systemUserProperties: (user) => pluginCall<UserPropertyDto[]>('database', 'system_user_properties', { user }),
  systemAssignedRoles: () => pluginCall<string[]>('database', 'system_assigned_roles', {}),
  systemUserSetProperty: (id, value, confirmed) => pluginCall<void>('database', 'system_user_set_property', { id, value, confirmed }),
  systemUserSet: (user, key, value, confirmed) => pluginCall<void>('database', 'system_user_set', { user, key, value, confirmed }),
  systemUserSetList: (user, key, values, confirmed) => pluginCall<void>('database', 'system_user_set_list', { user, key, values, confirmed }),
  systemUserCreate: (title, confirmed) => pluginCall<string>('database', 'system_user_create', { title, confirmed }),
  systemUserDelete: (user, confirmed) => pluginCall<void>('database', 'system_user_delete', { user, confirmed }),
  systemAliasConfigs: () => pluginCall<AliasConfigTable>('database', 'system_alias_configs', {}),
  systemAliasList: (serverIds) => pluginCall<AliasConfigDto[]>('database', 'system_alias_list', { serverIds }),
  systemServerIds: (configReference, systemName) => pluginCall<string[]>('database', 'system_server_ids', { configReference, systemName }),
  deployOverview: (projectRoot) => pluginCall<DeployOverview>('deploy', 'deploy_overview', { projectRoot }),
  deployPlan: (projectRoot, force, mapping) => pluginCall<DeployPlan>('deploy', 'deploy_plan', { projectRoot, force, mapping }),
  deployShowChanges: (projectRoot, key, mapping) => pluginCall<DeployChangeView>('deploy', 'deploy_show_changes', { projectRoot, key, mapping }),
  deployExecute: (projectRoot, keys, force, mapping, confirmed) => pluginCall<DeployOutcome>('deploy', 'deploy_execute', { projectRoot, keys, force, mapping, confirmed }),
  copyObject: (source, destRoot, newName) => typed('copy_object', () => commands.copyObject(source, destRoot, newName)),
  deleteObject: (source) => typed('delete_object', () => commands.deleteObject(source)).then(() => undefined),
  newObjectKinds: () => typed('new_object_kinds', () => commands.newObjectKinds()),
  validateNewName: (projectRoot, folder, name) => typed('validate_new_name', () => commands.validateNewName(projectRoot, folder, name)),
  createObject: (projectRoot, folder, name, title, reference) => typed('create_object', () => commands.createObject(projectRoot, folder, name, title ?? null, reference ?? null)),
  renamePlan: (projectRoot, source, newName) => typed('rename_plan', () => commands.renamePlan(projectRoot, source, newName)),
  renameObject: (projectRoot, source, newName) => typed('rename_object', () => commands.renameObject(projectRoot, source, newName)),
  listProjectModels: (projectRoot) => typed('list_project_models', () => commands.listProjectModels(projectRoot)),
  exportProjectZip: (projectRoot, models, target) => typed('export_project_zip', () => commands.exportProjectZip(projectRoot, models, target)),
  inspectProjectZip: (projectRoot, zipPath) => typed('inspect_project_zip', () => commands.inspectProjectZip(projectRoot, zipPath)),
  importProjectZip: (projectRoot, zipPath, selected, overwrite) => typed('import_project_zip', () => commands.importProjectZip(projectRoot, zipPath, selected, overwrite)),
  pickSaveFile: (title, defaultName, label, extensions) => typed('pick_save_file', () => commands.pickSaveFile(title ?? null, defaultName, label, extensions)),
  readJditoTypes: (projectRoot) => typed('read_jdito_types', () => commands.readJditoTypes(projectRoot)),
  gitOverview: (projectRoot) => gitCall<GitOverview>('git_overview', { projectRoot }),
  gitCommit: (projectRoot, message, paths) => gitCall<GitOutput>('git_commit', { projectRoot, message, paths }),
  gitPull: (projectRoot) => withCheckoutChoice('', (mode) => gitNetCall<GitOutput>('git_pull', projectRoot, { mode }), 'pull'),
  gitPush: (projectRoot) => gitNetCall<GitOutput>('git_push', projectRoot),
  gitUnpushed: (projectRoot) => gitCall<GitCommit[]>('git_unpushed', { projectRoot }),
  gitIncoming: (projectRoot) => gitNetCall<GitCommit[]>('git_incoming', projectRoot),
  gitPushTo: (projectRoot, hash) => gitNetCall<GitOutput>('git_push_to', projectRoot, { hash }),
  gitCheckout: (projectRoot, branch) => withCheckoutChoice(branch, (mode) => gitCall<GitOutput>('git_checkout', { projectRoot, branch, mode })),
  gitRepoLink: (projectRoot) => gitCall<RepoLink>('git_repo_link', { projectRoot }),
  gitLogin: async (projectRoot, user, password) => {
    await gitCall<string>('git_login', { projectRoot, user, password })
  },
  gitConnect: (projectRoot, url, sshKey, user, password) => gitCall<string>('git_connect', { projectRoot, url, sshKey, user, password }),
  projectClone: (url, location, name, sshKey, password) => gitCall<string>('clone_repository', { url, location, name, sshKey, password }),
  projectCreateEmpty: (location, name) => typed('project_create_empty', () => commands.projectCreateEmpty(location, name)),
  transpileCompare: (reference, projectRoot) => typed('transpile_compare', () => commands.transpileCompare(reference, projectRoot)),
  gitCreateBranch: (projectRoot, name, start) => withCheckoutChoice(name, (mode) => gitCall<GitOutput>('git_create_branch', { projectRoot, name, start, mode })),
  scmStatus: (projectRoot) => gitCall<ScmOverview>('scm_status', { projectRoot }),
  scmStage: (projectRoot, paths) => gitCall<GitOutput>('scm_stage', { projectRoot, paths }),
  scmStageAll: (projectRoot) => gitCall<GitOutput>('scm_stage_all', { projectRoot }),
  scmUnstage: (projectRoot, paths) => gitCall<GitOutput>('scm_unstage', { projectRoot, paths }),
  scmDiscard: (projectRoot, paths) => gitCall<GitOutput>('scm_discard', { projectRoot, paths }),
  scmCommit: (projectRoot, message) => gitCall<GitOutput>('scm_commit', { projectRoot, message }),
  scmSync: (projectRoot) => withCheckoutChoice('', (mode) => gitNetCall<GitOutput>('scm_sync', projectRoot, { mode }), 'pull'),
  scmHistory: (projectRoot, limit) => gitCall<GitCommit[]>('scm_history', { projectRoot, limit }),
  scmCommitFiles: (projectRoot, hash) => gitCall<CommitFile[]>('scm_commit_files', { projectRoot, hash }),
  scmDiff: (projectRoot, path, side: ScmDiffSide, hash) => gitCall<DiffContent>('scm_diff', { projectRoot, path, side, hash }),
  scmGutter: (projectRoot, file) => gitCall<Gutter>('scm_gutter', { projectRoot, file }),
}
