import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { downloadBlob } from '@/lib/download'
import { todayStamp } from '@/lib/dates'
import { buildIcs } from '@/lib/ics'
import { getCalendarEvents, type CalendarExportOptions } from '../service'

interface CalendarExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const OPTIONS: { key: keyof CalendarExportOptions; label: string; hint: string }[] = [
  { key: 'cards', label: 'Tarjetas', hint: 'Cuándo cierra y cuándo vence cada una.' },
  { key: 'fixed', label: 'Gastos fijos y cuotas', hint: 'Los que no pagás con tarjeta (esos ya van en el resumen).' },
  {
    key: 'amounts',
    label: 'Mostrar los montos',
    hint: 'Los nombres de tarjetas y gastos van siempre; si tu calendario se sincroniza con la nube, los montos también.',
  },
]

/** Downloads the next 12 months of payments as an .ics file, which the
 *  phone's calendar imports with a reminder the day before. Built on the
 *  device — nothing is sent anywhere. */
export function CalendarExportDialog({ open, onOpenChange }: CalendarExportDialogProps) {
  const [options, setOptions] = useState<CalendarExportOptions>({ cards: true, fixed: true, amounts: false })
  const [busy, setBusy] = useState(false)
  const nothingChosen = !options.cards && !options.fixed

  async function handleExport() {
    setBusy(true)
    try {
      const today = todayStamp()
      const events = await getCalendarEvents(options, today)
      if (events.length === 0) {
        toast.info('No hay vencimientos para agregar')
        return
      }
      downloadBlob(new Blob([buildIcs(events)], { type: 'text/calendar;charset=utf-8' }), `moneta-vencimientos-${today}.ics`)
      toast.success(events.length === 1 ? '1 fecha lista para tu calendario' : `${events.length} fechas listas para tu calendario`)
      onOpenChange(false)
    } catch {
      toast.error('No se pudo armar el archivo del calendario')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar al calendario</DialogTitle>
          <DialogDescription>
            Bajá los vencimientos de los próximos 12 meses y abrí el archivo en tu celular. En iPhone cada uno trae un
            aviso el día antes; Google Calendar usa tus avisos de siempre. Bajalo de nuevo cuando sumes una tarjeta o un
            gasto fijo (y al año, te lo recuerda); lo que pauses o borres sacalo a mano del calendario.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {OPTIONS.map(({ key, label, hint }) => (
            <div key={key} className="flex items-start gap-3">
              <Checkbox
                id={`calendar-${key}`}
                checked={options[key]}
                onCheckedChange={(checked) => setOptions((o) => ({ ...o, [key]: checked === true }))}
                aria-describedby={`calendar-${key}-hint`}
                className="mt-0.5"
              />
              <div className="grid gap-0.5">
                <Label htmlFor={`calendar-${key}`}>{label}</Label>
                <p id={`calendar-${key}-hint`} className="text-xs text-muted-foreground">
                  {hint}
                </p>
              </div>
            </div>
          ))}
        </div>
        {nothingChosen && (
          <p id="calendar-nothing" className="text-xs text-muted-foreground">
            Elegí tarjetas, gastos fijos o las dos.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => void handleExport()}
            disabled={busy || nothingChosen}
            {...(nothingChosen && { 'aria-describedby': 'calendar-nothing' })}
          >
            {busy ? 'Armando…' : 'Bajar el archivo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
