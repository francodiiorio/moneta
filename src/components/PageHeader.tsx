import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  /** Shown as a tab of a bigger page (src/app/hubs): that page has the
   *  title, so only the description and actions remain. */
  embedded?: boolean
}

export function PageHeader({ title, description, actions, embedded = false }: PageHeaderProps) {
  if (embedded) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {actions && <div className="flex shrink-0 items-center gap-2 sm:ml-auto">{actions}</div>}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-primary">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
