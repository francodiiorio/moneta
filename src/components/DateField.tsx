import { forwardRef, useState } from 'react'
import { CalendarIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatFullDate, fromDateStamp, isValidDateStamp, toDateStamp, type DateStamp } from '@/lib/dates'
import { cn } from '@/lib/cn'

interface DateFieldProps {
  /** `undefined` only to accept an optional react-hook-form field
   *  (`z.string().optional()`) as-is — treated the same as `''`. */
  value: DateStamp | undefined
  onChange: (value: DateStamp) => void
  onBlur?: () => void
  disabled?: boolean
  id?: string
  className?: string
  /** Forwarded to the trigger button — `FormControl` (see
   *  components/ui/form.tsx) injects these onto whatever single child it
   *  wraps, same as it does for `Input`/`SelectTrigger`, so the field
   *  still paints red and stays wired to the error message on failed
   *  validation instead of silently dropping that behavior. */
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-describedby'?: string
}

/** A `dd/mm/aaaa` date picker — never the native `<input type="date">`,
 *  whose display format follows the browser's own locale (almost always
 *  showing mm/dd/yyyy here) rather than the app's, regardless of any
 *  `lang` set on the page. Drop-in for a react-hook-form `field` — same
 *  `value`/`onChange` shape as the native input it replaces, still a
 *  `DateStamp` (yyyy-MM-dd) string on the wire.
 *
 *  Note for future callers: picking a day closes the popover by setting
 *  local `open` state directly, not through Radix's `onOpenChange` — so
 *  `onBlur` (react-hook-form's "touched" signal) only fires when the
 *  popover closes *without* picking a date (click-outside/Escape), not
 *  on a successful pick. Harmless today since no form in this repo uses
 *  `useForm({ mode: 'onBlur' })`, but worth knowing if one ever does. */
export const DateField = forwardRef<HTMLButtonElement, DateFieldProps>(function DateField(
  { value, onChange, onBlur, disabled, id, className, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedBy },
  ref,
) {
  const [open, setOpen] = useState(false)
  const selected = value && isValidDateStamp(value) ? fromDateStamp(value) : undefined

  return (
    <div className="relative">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) onBlur?.()
        }}
      >
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={ariaInvalid}
            aria-describedby={ariaDescribedBy}
            className={cn(
              'w-full justify-start font-normal',
              !selected && 'text-muted-foreground',
              selected && 'pr-8',
              className,
            )}
          >
            <CalendarIcon className="size-4" />
            {value && isValidDateStamp(value) ? formatFullDate(value) : 'Elegí una fecha'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            {...(selected && { defaultMonth: selected })}
            onSelect={(date) => {
              if (!date) return
              onChange(toDateStamp(date))
              setOpen(false)
            }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {selected && !disabled && (
        // Sibling to the trigger, not nested inside it — a <button> inside
        // a <button> is invalid HTML and unreachable for a11y.
        <button
          type="button"
          aria-label="Limpiar fecha"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => onChange('')}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
})
