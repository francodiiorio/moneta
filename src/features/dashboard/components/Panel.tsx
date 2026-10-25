import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/cn'

interface PanelProps {
  title: string
  icon: LucideIcon
  /** Where "Ver todo" goes — the section this panel summarizes. */
  to?: string
  linkLabel?: string
  className?: string
  /** Content grows to the card's height (a chart filling a stretched row). */
  fill?: boolean
  children: ReactNode
}

/** The Dashboard's section card: an icon, a title, a link to the full
 *  page, and the content. One shape for every block keeps the grid calm. */
export function Panel({ title, icon: Icon, to, linkLabel = 'Ver todo', className, fill = false, children }: PanelProps) {
  return (
    // min-w-0: as a grid item its min width is otherwise its content's, and
    // one long movement description would widen the whole column past the
    // screen on a phone.
    <Card className={cn('min-w-0 gap-3 py-4', className)}>
      <div className="flex items-center justify-between gap-2 px-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
          {title}
        </h2>
        {to && (
          <Link
            to={to}
            className="flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {linkLabel}
            <ChevronRight className="size-3.5" />
          </Link>
        )}
      </div>
      <div className={cn('px-4', fill && 'flex min-h-0 flex-1 flex-col')}>{children}</div>
    </Card>
  )
}

/** A panel with nothing yet: one line and the action that fills it. */
export function PanelEmpty({ text, to, action }: { text: string; to: string; action: string }) {
  return (
    <div className="flex flex-col items-start gap-1 py-2 text-sm">
      <p className="text-muted-foreground">{text}</p>
      <Link to={to} className="font-medium text-primary hover:underline">
        {action}
      </Link>
    </div>
  )
}
