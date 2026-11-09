import { useCallback, useState } from 'react'
import type { ForgeApi, LiquibaseConnection } from '../../api/ForgeApi'
import { choiceDialog } from '../../core/dialogService'
import { errorText } from '../../core/errorText'
import { notify } from '../../core/notifications'
import { getTunnelState, systemKey, systemNameOf } from '../../services/tunnelState'
import type { TranspileMode } from '../../settings/transpilerEngine'
import { objectLayout } from '../../tree/contextMenu'
import type { TreeNode } from '../../wire/types'
import type { OutputLine, OutputSubTab } from '../OutputPanel'
import type { LiquibaseChoice } from '../SelectDatabaseConnectionDialog'
import { timestamp } from './timestamp'

export interface LiquibaseDeps {
  api: ForgeApi
  showToolWindow: (id: 'output', focus?: boolean) => void
  appendLog: (sub: OutputSubTab, lines: OutputLine[]) => void
  transpile: (mode: TranspileMode, project?: string) => Promise<boolean>
  setOutputSub: (sub: OutputSubTab) => void
  setStatus: (text: string) => void
}

export type ConnectionPick = { connections: LiquibaseConnection[]; preferredAlias: string; title: string; resolve: (c: LiquibaseChoice | null) => void; onTranspile: () => Promise<boolean> }

// Liquibase > Update of a database alias: asks which database it would change, then runs the
// changelogs of .liquibase/<alias>; the lines of Liquibase appear in Output > Build.
export function useLiquibase({ api, showToolWindow, appendLog, transpile, setOutputSub, setStatus }: LiquibaseDeps) {
  const [connectionPick, setConnectionPick] = useState<ConnectionPick | null>(null)
  const runLiquibaseUpdate = useCallback(
    async (node: TreeNode, project: string) => {
      const alias = objectLayout(node.id)?.name
      if (!alias) return
      const prefix = systemKey(project, '')
      const connected = Object.entries(getTunnelState().bySystem)
        .filter(([key, value]) => value.connected && key.startsWith(prefix) && !key.includes('|alias:'))
        .map(([key]) => key)
      if (connected.length === 0) {
        notify('Connect a system first (Services): Liquibase updates the database of a connected system.', { kind: 'error', timeoutMs: 10000 })
        return
      }
      let system = connected[0]
      if (connected.length > 1) {
        const pick = await choiceDialog('Which system should be updated?', [...connected.map((key) => ({ id: key, label: systemNameOf(key) })), { id: '', label: 'Cancel' }], 'Liquibase Update')
        if (!pick) return
        system = pick
      }
      const log = (level: 'info' | 'error', text: string) => appendLog('build', [{ level, text: `[${timestamp()}] ${text}` }])
      try {
        // A project alias belongs to a target alias (THHIT_Data_alias -> Data_alias): that one owns the
        // database and the master changelog, which includes the changelogs of every module and alias.
        const plan = await api.liquibasePlan(project, alias)
        const connections = await api.liquibaseConnections(system)
        const choice = await new Promise<LiquibaseChoice | null>((resolve) =>
          setConnectionPick({
            connections,
            preferredAlias: plan.target_alias,
            title: `Which database should the changelogs of ${alias === plan.target_alias ? alias : `${alias} (part of ${plan.target_alias})`} update?`,
            resolve,
            onTranspile: () => transpile('partial', project),
          }),
        )
        if (!choice) return
        showToolWindow('output', false)
        setOutputSub('build')
        log('info', `Liquibase update of ${plan.target_alias} started`)
        if (!choice.useDist && !(await transpile('partial', project))) {
          log('error', 'The transpile failed, so the update did not start.')
          return
        }
        const message = await api.liquibaseUpdate(system, plan.target_alias, project, choice.connection.alias, true)
        const done = `Update successful: ${plan.target_alias} on ${choice.connection.database}`
        log('info', done)
        notify(done, { kind: 'success' })
        setStatus(done)
        void message
      } catch (e) {
        const text = errorText(e)
        log('error', text)
        notify(text, { kind: 'error', timeoutMs: 10000 })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, showToolWindow, appendLog, transpile],
  )
  return { connectionPick, setConnectionPick, runLiquibaseUpdate }
}
