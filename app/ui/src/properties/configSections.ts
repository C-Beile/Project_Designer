import { useSyncExternalStore } from 'react'
import type { AliasConfigDto } from '../wire/types'

// Sections of the alias config `_____CONFIGURATION` (original Designer, shots 101, 105, 108-115):
// the Navigator of the open config shows the tree System > Client, Modules, Logging, Custom, ...;
// the selected node decides which property groups the editor and the Properties panel show. The
// groups and property names below are copied from the screenshots; the value kinds (check box,
// combo, text) are read from how the original draws them. UNBELEGT: Nova Communication, NATS and
// JWT were not shown, the options of the combo boxes are unknown (a combo shows its current value),
// and properties of the config that no section claims are listed under "Other".

export interface SectionNode {
  id: string
  label: string
  children: SectionNode[]
}

const leaf = (id: string, label: string): SectionNode => ({ id, label, children: [] })

export const SECTION_TREE: SectionNode = {
  id: 'system',
  label: 'System',
  children: [
    leaf('client', 'Client'),
    { id: 'modules', label: 'Modules', children: [leaf('database', 'Database'), leaf('calendar', 'Calendar'), leaf('notifications', 'Notifications')] },
    leaf('logging', 'Logging'),
    { id: 'custom', label: 'Custom', children: [leaf('prefs', '_____PREFERENCES_PROJECT'), leaf('configuration', '_____CONFIGURATION')] },
    leaf('nova', 'Nova Communication'),
    { id: 'services', label: 'Services', children: [leaf('nats', 'NATS'), leaf('jwt', 'JWT')] },
  ],
}

export type PropKind = 'text' | 'checkbox' | 'combo'

interface GroupDef {
  label: string
  props: { name: string; kind?: PropKind }[]
}

const cb = (name: string) => ({ name, kind: 'checkbox' as const })
const combo = (name: string) => ({ name, kind: 'combo' as const })
const txt = (name: string) => ({ name })

const CLIENT: GroupDef[] = [
  { label: 'Neon', props: [cb('neonVaadinClientEnabled'), cb('neonHandleCORS'), txt('neonIdleTimeout'), combo('neonLoginTypeIds')] },
  { label: 'Client', props: [txt('clientTitleText'), combo('clientLogo'), txt('clientLogoFile'), txt('clientBackgroundFile'), combo('clientBackground'), txt('clientTimeout'), txt('clientTheme'), txt('clientDarkTheme')] },
  { label: 'Login', props: [txt('securitySSOUserTemplate'), txt('loginList')] },
]

const SYSTEM: GroupDef[] = [
  { label: 'Neon', props: [txt('neonHttpPort'), txt('neonHttpsPort'), txt('webserverPath'), cb('neonDisableConnectionSecurity'), cb('neonUseSelfSignedCertificate')] },
  { label: 'System', props: [cb('securityConnectionSSLEnabled'), cb('securitySSLDisableCertificateCheck')] },
  { label: 'Cloud', props: [txt('systemOrigin'), txt('apiGatewayToken')] },
  { label: 'JDito', props: [cb('jditoDebuggerEnabled')] },
  { label: 'Serverfarm', props: [cb('serverFarmEnabled')] },
  { label: 'Userdirectory', props: [cb('userdirectoryDbIgnoreCase')] },
  { label: 'JDito Webservices - Server', props: [cb('jditoWebserviceEnabled'), txt('jditoWebserviceIdleTimeout')] },
  { label: 'Anti Bruteforce Login Module', props: [cb('antiBruteforceLoginModuleActive'), txt('maxInvalidLoginAttempts'), txt('maxInvalidLoginAttemptsIntervall'), cb('automaticUnblockingActive'), txt('automaticUnblockingIntervall')] },
  { label: 'Spellchecking', props: [cb('spellcheckerEnabled'), txt('ckeditorConfig')] },
  { label: 'Send us feedback', props: [cb('userSatisfactionSurveyEnabled')] },
]

const MODULES: GroupDef[] = [
  { label: 'MSTeams', props: [cb('teamsEnabled')] },
  { label: 'Indexsearch', props: [cb('indexsearchEnabled'), combo('indexsearchAlias')] },
  { label: 'Email', props: [cb('mailGlobalEnabled'), cb('mailBridgeEnabled')] },
  { label: 'Business process management', props: [cb('workflowEngineEnabled'), combo('workflowModelerAlias'), combo('workflowEngineAlias'), cb('workflowTimerEventsEnabled'), txt('workflowEngineUser'), combo('workflowEngineLoginTypeIds')] },
  { label: 'Telephony', props: [cb('telephonyEnabled')] },
  { label: 'Monitoring', props: [combo('processHistoryCollectorAlias'), txt('maxEntries'), txt('maxEntryLifetimeInDatabase')] },
  { label: 'Telemetry', props: [cb('telemetryExternalEnabled'), combo('telemetryExternalLoginTypeIds')] },
  { label: 'Analytics', props: [cb('usageStatisticsEnabled')] },
  { label: 'Server Control', props: [cb('serverCommandWebserviceEnabled')] },
]

const DATABASE: GroupDef[] = [{ label: 'Database', props: [txt('systemDBRequestWarnTimeout'), txt('systemDBRequestTimeout'), cb('databaseAuditEnabled'), combo('databaseDBSyncType')] }]

const CALENDAR: GroupDef[] = [
  { label: 'Calendar', props: [cb('calendarEnabled'), combo('calendarAlias'), combo('calendarAliasTasks')] },
  { label: 'Calendar Cache', props: [combo('calendarCachingAlias'), cb('calendarShowErrorOnGetEntries')] },
  { label: 'Calendar Subscription', props: [cb('calendarSubscriptionsEnabled'), txt('calendarSubscriptionsCheckerInterval'), txt('calendarSubscriptionsInitialDuration'), txt('calendarSubscriptionsUpdateDuration')] },
  { label: 'Calendar Sync', props: [cb('calendarSyncEnabled')] },
]

const NOTIFICATIONS: GroupDef[] = [
  { label: 'Notifications', props: [cb('neonNotificationCenterEnabled'), cb('neonNotificationAutoDeleteEnabled'), txt('neonNotificationCleanupIntervall')] },
  { label: 'Push Notifications', props: [cb('neonFirebaseEnabled')] },
]

const LOGGING: GroupDef[] = [
  { label: 'Logging', props: [combo('loggingDebugLevel'), combo('loggingPriority'), txt('loggingJDitoThreshold'), txt('loggingDBThreshold')] },
  { label: 'Console', props: [cb('loggingConsoleEnabled')] },
  { label: 'File', props: [cb('loggingFileEnabled'), txt('loggingFileloggerMaxSize'), txt('loggingFileloggerFileCount'), combo('loggingFileloggerDiscreteModules')] },
  { label: 'Telnet', props: [cb('loggingTelnetEnabled')] },
  { label: 'Remote', props: [cb('loggingRemoteEnabled')] },
]

const PREFS: GroupDef[] = [
  { label: 'Others', props: [txt('geo.maptiler.apikey'), txt('snapADDY.apiKey'), cb('snapADDY.isEnabled'), txt('docx-templater.apiUrl'), txt('sign8.apiKey'), txt('sign8.secret'), cb('sign8.isEnabled')] },
]

const CONFIGURATION: GroupDef[] = [
  {
    label: 'Others',
    props: [
      cb('dataCaching.client.forceDisable'),
      txt('geo.maptiler.apikey'),
      txt('bulkmail.dateToSendPassedAfter'),
      txt('bulkmail.baseReplacementURL'),
      txt('bulkmail.fileStorage'),
      txt('bulkmail.user'),
      txt('bulkmail.bg.serverId'),
      txt('mosaico.url'),
      cb('snapADDY.isEnabled'),
      txt('snapADDY.apiKey'),
      cb('sign8.isEnabled'),
      txt('sign8.apiKey'),
      txt('sign8.token_id'),
      txt('sign8.interface_id'),
      txt('sign8.organization_id'),
      txt('sign8.systemApiUrl'),
      txt('sign8.signingUrl'),
      txt('sign8.secret'),
      txt('mailbridgeService.serverAddress'),
      txt('mailbridge.user'),
      txt('msGraph.client_id'),
      txt('msGraph.client_secret'),
      txt('msGraph.tenant'),
      txt('this.URL'),
      txt('emailNotification.sender'),
      txt('snapADDY.apiUrl'),
      txt('docx-templater.apiUrl'),
      txt('docx-templater.password'),
      txt('docx-templater.user'),
      txt('database.binarypath'),
      txt('microsoftGraphApi.BaseURL'),
      txt('microsoftGraphApi.version'),
      txt('microsoftGraphApi.defaultAuthAlias'),
      txt('microsoftGraphApi.defaultScope'),
    ],
  },
]

const DEFS: Record<string, GroupDef[]> = {
  client: CLIENT,
  system: SYSTEM,
  modules: MODULES,
  database: DATABASE,
  calendar: CALENDAR,
  notifications: NOTIFICATIONS,
  logging: LOGGING,
  prefs: PREFS,
  configuration: CONFIGURATION,
}

export interface SheetRow {
  name: string
  value: string
  secret: boolean
  /** The config has a value for it; unset rows are shown grey and italic. */
  set: boolean
  kind: PropKind
}

export interface SheetGroup {
  label: string
  rows: SheetRow[]
}

export function isConfigurationAlias(name: string): boolean {
  return /^_*configuration$/i.test(name.trim())
}

export function sectionLabel(id: string): string {
  const find = (n: SectionNode): string | null => (n.id === id ? n.label : n.children.map(find).find((x) => x !== null) ?? null)
  return find(SECTION_TREE) ?? id
}

const isSecretName = (n: string) => /token|password|secret|apikey|api_key|client_secret/i.test(n)

/** Groups of one section merged with the values of the config; `defined` is false for a section nobody has seen yet. */
export function sectionSheet(config: AliasConfigDto, sectionId: string): { groups: SheetGroup[]; defined: boolean } {
  const values = new Map<string, { name: string; value: string; secret: boolean }>()
  for (const g of config.groups) for (const p of g.props) values.set(p.name.toLowerCase(), { name: p.name, value: p.value, secret: p.secret })
  const defs = DEFS[sectionId]
  if (!defs) return { groups: [], defined: false }
  const groups: SheetGroup[] = defs.map((g) => ({
    label: g.label,
    rows: g.props.map((p) => {
      const v = values.get(p.name.toLowerCase())
      const secret = v?.secret ?? isSecretName(p.name)
      return { name: p.name, value: v?.value ?? '', secret, set: !!v && (v.value !== '' || v.secret), kind: p.kind ?? 'text' }
    }),
  }))
  if (sectionId === 'system') {
    const claimed = new Set<string>()
    for (const defsOfSection of Object.values(DEFS)) for (const g of defsOfSection) for (const p of g.props) claimed.add(p.name.toLowerCase())
    const other: SheetRow[] = []
    for (const [key, v] of values) {
      if (claimed.has(key)) continue
      other.push({ name: v.name, value: v.value, secret: v.secret, set: v.value !== '' || v.secret, kind: 'text' })
    }
    if (other.length > 0) groups.push({ label: 'Other', rows: other })
  }
  return { groups, defined: true }
}

let current = 'client'
const listeners = new Set<() => void>()

export function getConfigSection(): string {
  return current
}

export function setConfigSection(id: string): void {
  if (id === current) return
  current = id
  listeners.forEach((l) => l())
}

export function useConfigSection(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}
