import { useEffect, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'

// The icons an `iconId` can name, loaded once per window and shared by every editor that draws object icons.
let cache: Promise<ReadonlyMap<string, string>> | null = null

function load(api: ForgeApi): Promise<ReadonlyMap<string, string>> {
  if (!cache) {
    cache = api
      .listIcons()
      .then((list) => new Map(list.map((i) => [i.id, i.svg] as const)))
      .catch(() => {
        cache = null
        return new Map<string, string>()
      })
  }
  return cache
}

export function useIconSvgs(api: ForgeApi): ReadonlyMap<string, string> {
  const [icons, setIcons] = useState<ReadonlyMap<string, string>>(() => new Map())
  useEffect(() => {
    let cancelled = false
    void load(api).then((m) => !cancelled && setIcons(m))
    return () => {
      cancelled = true
    }
  }, [api])
  return icons
}
