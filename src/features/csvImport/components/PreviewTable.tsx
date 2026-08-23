import { ChevronLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { MoneyText } from '@/components/MoneyText'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { negate, type Money } from '@/domain/money'
import { formatShortDate } from '@/lib/dates'
import type { PreviewRow } from '../service'

/** `row.amount` is always a positive magnitude (what the builders expect
 *  — see service.ts) — negate it here, display-only, so an expense shows
 *  red/negative and an income shows green/positive like everywhere else
 *  in the app, without changing what actually gets persisted. */
function signedForDisplay(row: PreviewRow): Money | undefined {
  if (!row.amount || !row.kind) return row.amount
  return row.kind === 'expense' ? negate(row.amount) : row.amount
}

interface PreviewTableProps {
  rows: PreviewRow[]
  selected: ReadonlySet<number>
  onToggle: (index: number) => void
  selectedCount: number
  duplicateCount: number
  invalidCount: number
  onBack: () => void
  onImport: () => void
  isBusy: boolean
}

export function PreviewTable({
  rows,
  selected,
  onToggle,
  selectedCount,
  duplicateCount,
  invalidCount,
  onBack,
  onImport,
  isBusy,
}: PreviewTableProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {selectedCount} a importar
        {duplicateCount > 0 && ` · ${duplicateCount} posible${duplicateCount === 1 ? '' : 's'} duplicado${duplicateCount === 1 ? '' : 's'}`}
        {invalidCount > 0 && ` · ${invalidCount} fila${invalidCount === 1 ? '' : 's'} inválida${invalidCount === 1 ? '' : 's'}`}
      </p>

      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Fecha</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const displayAmount = signedForDisplay(row)
              return (
              <TableRow key={row.index} className={row.status === 'invalid' ? 'opacity-50' : undefined}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(row.index)}
                    disabled={row.status === 'invalid'}
                    onCheckedChange={() => onToggle(row.index)}
                    aria-label={`Importar fila ${row.index + 1}`}
                  />
                </TableCell>
                <TableCell>{row.date ? formatShortDate(row.date) : row.raw[0] || '—'}</TableCell>
                <TableCell className="max-w-64 truncate" title={row.description}>
                  {row.description ?? row.raw.join(' ')}
                </TableCell>
                <TableCell className="text-right">
                  {displayAmount ? <MoneyText value={displayAmount} signColor /> : '—'}
                </TableCell>
                <TableCell>
                  {row.status === 'duplicate' && <Badge variant="secondary">Posible duplicado</Badge>}
                  {row.status === 'invalid' && (
                    <Badge variant="destructive" title={row.invalidReason}>
                      {row.invalidReason}
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} disabled={isBusy}>
          <ChevronLeft className="size-4" />
          Volver
        </Button>
        <Button onClick={onImport} disabled={isBusy || selectedCount === 0}>
          Importar {selectedCount} movimiento{selectedCount === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  )
}
