import { ConfiguredIcon } from '../core/icons/Icon'

// Toolbar- und Panel-Icons. Name, Stil und Farbe kommen aus app/config/style.toml: Grundwerte in
// [icons.toolbar] (Steuerzeichen in [icons.control]), Einzel-Icons in [icon.<id>]. Die Namen hier
// (`fallback`) gelten, solange style.toml für eine Id keinen eigenen Namen setzt. Die Ids der Knöpfe
// sind die Namen ohne "Icon" in kebab-case (IconSaveAll = save-all).

export const IconOpenProject = () => <ConfiguredIcon id="open-project" area="toolbar" fallback="folder-open" />

export const IconSave = () => <ConfiguredIcon id="save" area="toolbar" fallback="floppy-disk" />

export const IconSaveAll = () => <ConfiguredIcon id="save-all" area="toolbar" fallback="floppy-disk-back" />

export const IconRefresh = () => <ConfiguredIcon id="refresh" area="toolbar" fallback="arrows-clockwise" />

export const IconBack = () => <ConfiguredIcon id="back" area="toolbar" fallback="arrow-left" />

export const IconForward = () => <ConfiguredIcon id="forward" area="toolbar" fallback="arrow-right" />

export const IconUndo = () => <ConfiguredIcon id="undo" area="toolbar" fallback="arrow-u-up-left" />

export const IconRedo = () => <ConfiguredIcon id="redo" area="toolbar" fallback="arrow-u-up-right" />

export const IconRun = () => <ConfiguredIcon id="run" area="toolbar" fallback="play" />

export const IconDeploy = () => <ConfiguredIcon id="deploy" area="toolbar" fallback="download-simple" />

export const IconTranspile = () => <ConfiguredIcon id="transpile" area="toolbar" fallback="hammer" />

export const IconClose = () => <ConfiguredIcon id="close" area="control" fallback="x" size="sm" />

export const IconMinimize = () => <ConfiguredIcon id="minimize" area="control" fallback="caret-left" size="sm" />

export const IconNew = () => <ConfiguredIcon id="new" area="toolbar" fallback="file-plus" />

export const IconOpenModel = () => <ConfiguredIcon id="open-model" area="toolbar" fallback="file-magnifying-glass" />

export const IconCommit = () => <ConfiguredIcon id="commit" area="toolbar" fallback="check" />

export const IconPull = () => <ConfiguredIcon id="pull" area="toolbar" fallback="arrow-line-down" />

export const IconPush = () => <ConfiguredIcon id="push" area="toolbar" fallback="arrow-line-up" />

export const IconDiff = () => <ConfiguredIcon id="diff" area="toolbar" fallback="git-diff" />

export const IconHistory = () => <ConfiguredIcon id="history" area="toolbar" fallback="clock-counter-clockwise" />

export const IconLocalChanges = () => <ConfiguredIcon id="local-changes" area="toolbar" fallback="note-pencil" />

export const IconDeployOpened = () => <ConfiguredIcon id="deploy-opened" area="toolbar" fallback="cloud-arrow-down" />

export const IconSql = () => <ConfiguredIcon id="sql" area="toolbar" fallback="database" />

export const IconRest = () => <ConfiguredIcon id="rest" area="toolbar" fallback="arrows-left-right" />

export const IconDependencies = () => <ConfiguredIcon id="dependencies" area="toolbar" fallback="tree-structure" />

export const IconBug = () => <ConfiguredIcon id="bug" area="toolbar" fallback="bug" />

export const IconExtensionPack = () => <ConfiguredIcon id="extension-pack" area="toolbar" fallback="package" />

export const IconFind = () => <ConfiguredIcon id="find" area="toolbar" fallback="magnifying-glass" />
