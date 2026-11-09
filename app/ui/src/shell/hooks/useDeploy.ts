import { useCallback, useState } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { notify } from '../../core/notifications'
import { getOptions } from '../../settings/options'
import { getTunnelState, setConnectedSystem, setSystemsDb } from '../../services/tunnelState'
import type { TranspileMode } from '../../settings/transpilerEngine'
import type { TreeNode } from '../../wire/types'
import { boolField, textField } from '../../wire/types'
import { useOsDialog } from '../../windows/useOsDialog'
import { openDialogWindow, osWindowsAvailable } from '../../windows/windowService'
import { systemWarning, type DeployOptionsPayload, type DeployOptionsResult, type DeploySystem } from '../DeployOptionsDialog'
import type { CommandMap } from './commandTypes'

export interface DeployDeps {
  api: ForgeApi
  root: string
  tree: TreeNode[]
  projects: string[]
  projectOf: (top: TreeNode) => string
  transpile: (mode: TranspileMode, project?: string) => Promise<boolean>
  setStatus: (text: string) => void
}

// Deploy and Build and Deploy: first dialog (project, system, options) as a window of its own, then
// the optional build, then the plan with its explicit confirmation. Nothing is written silently.
export function useDeploy({ api, root, tree, projects, projectOf, transpile, setStatus }: DeployDeps) {
  const [deployOptions, setDeployOptions] = useState<{ payload: DeployOptionsPayload; resolve: (r: DeployOptionsResult | null) => void } | null>(null)
  const [deployRun, setDeployRun] = useState<{ project: string; system: string; force: boolean; checkScan: boolean; warning: string | null } | null>(null)
  const startDeploy = useCallback(
    async (buildFirst: boolean) => {
      if (!root.trim()) return
      const systemsOfProject = async (project: string) => {
        const top = tree.find((t) => projectOf(t) === project) ?? tree[0]
        const nodes = (top?.children.find((c) => c.folder === 'system')?.children ?? []).filter((n) => n.object_type === 'system' && !n.id.startsWith('missing:'))
        const list: DeploySystem[] = await Promise.all(
          nodes.map(async (n) => {
            const t = await api.getPropertyTree(n.id).catch(() => null)
            const text = (k: string) => (t ? (textField(t, k) ?? '') : '')
            return {
              name: n.label,
              tunnelRef: text('tunnelConfigPath'),
              serverRef: text('serverConfigPath'),
              productive: t ? boolField(t, 'productiveSystem') === true : false,
              cloud: text('cloudSystemId') !== '' || /cloud/i.test(text('serverConfigPath')),
            }
          }),
        )
        return { systems: list, defaultSystem: nodes.find((n) => n.bold)?.label ?? list[0]?.name ?? '' }
      }
      const openProjects = projects.length > 0 ? projects : [root]
      const systemsByProject: Record<string, { systems: DeploySystem[]; defaultSystem: string }> = {}
      for (const p of openProjects) systemsByProject[p] = await systemsOfProject(p)
      const systems = systemsByProject[root]?.systems ?? (await systemsOfProject(root)).systems
      const payload: DeployOptionsPayload = {
        projects: projects.length > 0 ? projects : [root],
        project: root,
        systems,
        defaultSystem: systemsByProject[root]?.defaultSystem ?? systems[0]?.name ?? '',
        systemsByProject,
        connectedSystem: getTunnelState().connectedSystem,
        openSystems: Object.entries(getTunnelState().bySystem).filter(([, v]) => v.connected || v.tunnel_up).map(([k]) => k).filter(Boolean),
        buildFirst,
        checkScan: getOptions().general.checkScanOnDeploy,
      }
      const result = osWindowsAvailable()
        ? await openDialogWindow<DeployOptionsResult>('deploy', buildFirst ? 'Build and Deploy' : 'Deploy', { width: 460, height: 420 }, payload, { modal: true }).catch(() => null)
        : await new Promise<DeployOptionsResult | null>((resolve) => setDeployOptions({ payload, resolve }))
      setDeployOptions(null)
      if (!result) return
      if (result.connectedSystem) await api.dbActivate(result.connectedSystem).catch(() => false)
      setSystemsDb(await api.dbSystems().catch(() => []))
      setConnectedSystem(result.connectedSystem)
      if (result.build) {
        const ok = await transpile('partial', result.project)
        if (!ok) {
          notify('Build and Deploy stopped: the build failed. See Output > Build and Problems.', { kind: 'error', timeoutMs: 10000 })
          return
        }
      }
      setDeployRun({ project: result.project, system: result.system, force: result.force, checkScan: result.checkScan, warning: systemWarning((systemsByProject[result.project]?.systems ?? systems).find((x) => x.name === result.system)) })
    },
    [api, root, tree, projects, projectOf, transpile],
  )

  useOsDialog<{ message: string }>(
    deployRun !== null,
    () => ({ name: 'deployplan', title: 'Deploy', size: { width: 900, height: 660 }, payload: { project: deployRun?.project, system: deployRun?.system, force: deployRun?.force, checkScan: deployRun?.checkScan, warning: deployRun?.warning } }),
    (r) => {
      if (!r) return
      notify(r.message, { kind: 'success', timeoutMs: 10000 })
      setStatus(r.message)
    },
    () => setDeployRun(null),
  )

  const commands: CommandMap = {
    'project.deploy': () => {
      void startDeploy(false)
    },
    'project.buildDeploy': () => {
      void startDeploy(true)
    },
  }

  return { deployOptions, deployRun, setDeployRun, startDeploy, commands }
}
