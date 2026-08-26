import * as React from "react"
import { DayPicker } from "react-day-picker"
import { es } from "react-day-picker/locale"
import "react-day-picker/style.css"

import { cn } from "@/lib/cn"
import { formatSpokenDate } from "@/lib/dates"

function Calendar({ className, ...props }: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      locale={es}
      showOutsideDays
      // react-day-picker's nav-button aria-labels are hardcoded English
      // regardless of `locale` (only day/month names follow it) — CLAUDE.md
      // requires Spanish for user-facing text, screen readers included.
      labels={{
        labelPrevious: () => 'Ir al mes anterior',
        labelNext: () => 'Ir al mes siguiente',
        labelDayButton: (date, modifiers) => {
          const formatted = formatSpokenDate(date)
          if (modifiers.selected) return `${formatted}, seleccionado`
          if (modifiers.today) return `Hoy, ${formatted}`
          return formatted
        },
      }}
      className={cn(
        // Maps react-day-picker's own CSS variables (see its style.css)
        // to this app's tokens instead of overriding every subcomponent's
        // className by hand — same colors/radius/font as the rest of the UI.
        "bg-popover p-3 text-popover-foreground [--rdp-accent-background-color:var(--accent)] [--rdp-accent-color:var(--primary)] [--rdp-day-height:2.25rem] [--rdp-day-width:2.25rem] [--rdp-day_button-border-radius:var(--radius-md)] [--rdp-day_button-height:2.25rem] [--rdp-day_button-width:2.25rem] [--rdp-font-family:var(--font-sans)] [--rdp-nav_button-height:1.75rem] [--rdp-nav_button-width:1.75rem] [--rdp-selected-border:2px_solid_var(--primary)] [--rdp-today-color:var(--primary)]",
        className
      )}
      {...props}
    />
  )
}

export { Calendar }
