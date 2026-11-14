import type { ReactNode } from 'react'

export function GalleryRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ui-Gallery-row">
      <h4>{title}</h4>
      <div className="ui-Gallery-items">{children}</div>
    </section>
  )
}
