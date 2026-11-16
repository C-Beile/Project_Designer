import { useState } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { fromProblemDto, setProblems } from '../../problems/problemStore'
import type { TreeNode } from '../../wire/types'
import { useAbortableEffect } from '../../core/hooks/useAbortableEffect'

// Project-wide problem scan (read-only): after a project opens or refreshes and after saves.
export function useProblemScan(api: ForgeApi, projects: string[], trees: Record<string, TreeNode[]>, reloadToken: number, scanTick: number) {
  const [scanning, setScanning] = useState(false)
  useAbortableEffect((signal) => {
    const open = projects.filter((p) => p.trim() && trees[p])
    if (open.length === 0) return
    const timer = window.setTimeout(() => {
      setScanning(true)
      Promise.all(
        open.map((p) =>
          api
            .scanProblems(p)
            .then((list) => {
              if (!signal.aborted) setProblems(`scan:${p}`, list.map((d) => fromProblemDto(d, `scan:${p}`)))
            })
            .catch(() => {}),
        ),
      ).finally(() => {
        if (!signal.aborted) setScanning(false)
      })
    }, 400)
    return () => {
      window.clearTimeout(timer)
    }
    // Only the set of loaded projects and explicit triggers start a scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projects.join('|'), Object.keys(trees).join('|'), reloadToken, scanTick])
  return scanning
}
