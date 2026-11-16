import { createContext, useContext, type ReactNode } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { DbStatus } from '../wire/types'
import { ServicesPanel } from './ServicesPanel'

export const SERVICES_PANEL_ID = 'services'

export interface ServicesDockValue {
  api: ForgeApi
  db: DbStatus
  onDbChange: (status: DbStatus) => void
  onOpenSql: (sql: string) => void
  projects: string[]
}

const ServicesDockContext = createContext<ServicesDockValue | null>(null)

/** Reicht dem Services-Panel im Docking-Gitter die Daten der Shell durch (Panels von Plugins bekommen keine Props). */
export function ServicesDockProvider({ value, children }: { value: ServicesDockValue; children: ReactNode }) {
  return <ServicesDockContext.Provider value={value}>{children}</ServicesDockContext.Provider>
}

export function ServicesDockPanel() {
  const value = useContext(ServicesDockContext)
  if (!value) return null
  return <ServicesPanel api={value.api} db={value.db} onDbChange={value.onDbChange} onOpenSql={value.onOpenSql} projects={value.projects} />
}
