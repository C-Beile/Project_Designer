import { useEffect, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { AliasConfigDto, TreeNode } from '../wire/types'
import { useTunnelState } from '../services/tunnelState'
import { useProjectIndex } from '../editors/projectIndex'
import { AliasConfigPanel } from '../properties/AliasConfigPanel'

// Editor tab of one alias config of a system (original Designer, shot 84): full-width grouped
// property sheet Name | Value. The values come from the system database of exactly this system;
// passwords are masked and never reach the UI. Writing back is not built, so the sheet is read-only.

export interface AliasConfigRef {
  key: string
  system: string
  alias: string
  reference: string
  /** Absolute path of the tunnel config of the system (the browser of another alias opens its session through it). */
  tunnelConfig?: string
  /** Opens the database browser of a database alias instead of its property sheet. */
  browse?: boolean
}

export function aliasConfigTabNode(ref: AliasConfigRef): TreeNode {
  return {
    id: `${ref.browse ? 'dbbrowser' : 'aliasconfig'}:${ref.key}::${ref.alias}`,
    label: ref.browse ? `Database - ${ref.alias} (${ref.system})` : `${ref.alias}_${ref.system}`,
    object_type: null,
    kind: 'aliasconfig',
    path: JSON.stringify(ref),
    is_leaf: true,
    children: [],
  }
}

export function parseAliasConfigRef(path: string | undefined): AliasConfigRef | null {
  try {
    const v = JSON.parse(path ?? '') as AliasConfigRef
    return v && typeof v.key === 'string' && typeof v.alias === 'string' ? v : null
  } catch {
    return null
  }
}

export function AliasConfigTab({ api, path }: { api: ForgeApi; path: string | undefined }) {
  const ref = parseAliasConfigRef(path)
  const tunnel = useTunnelState()
  const up = ref ? !!tunnel.bySystem[ref.key]?.connected : false
  const index = useProjectIndex()
  const [config, setConfig] = useState<AliasConfigDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setConfig(null)
    setError(null)
    if (!ref || !up) return
    ;(async () => {
      await api.dbActivate(ref.key).catch(() => false)
      const ids = await api.systemServerIds(ref.reference, ref.system).catch(() => [] as string[])
      const list = await api.systemAliasList(ids)
      const found = list.find((c) => c.name === ref.alias) ?? null
      if (!cancelled) {
        setConfig(found)
        if (found) index?.selectAliasConfig?.(found, ref.system)
        if (!found) setError(`${ref.alias} is not in the system database of ${ref.system}.`)
      }
    })().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, path, up, tunnel.reload])

  if (!ref) return <p className="forge-field-error">The alias config reference of this tab is unreadable.</p>
  if (!up) return <p className="forge-field-hint">Connection to the database of {ref.system} unavailable. Open its tunnel in the system editor.</p>
  return (
    <div className="alias-config-tab" aria-label={`${ref.alias} config`}>
      {error ? <p className="forge-field-error" role="alert">{error}</p> : null}
      {!config && !error ? <p className="forge-field-hint">Please Wait…</p> : null}
      {config ? (
        <AliasConfigPanel config={config} system={ref.system} editable />
      ) : null}
    </div>
  )
}
