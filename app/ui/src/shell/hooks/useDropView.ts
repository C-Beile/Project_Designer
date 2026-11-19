import { useEffect, useRef } from 'react'
import { notify } from '../../core/notifications'
import { readViewFile } from '../../core/viewFiles'
import type { TreeNode } from '../../wire/types'

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

export function useDropView(open: (node: TreeNode) => void | Promise<void>) {
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? [])
      void (async () => {
        for (const file of files) {
          const result = await readViewFile(file)
          if (result.ok) await openRef.current(result.node)
          else notify(result.reason, { kind: 'warning' })
        }
      })()
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])
}
