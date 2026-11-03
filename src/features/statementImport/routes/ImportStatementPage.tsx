import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { CheckCircle2, ChevronLeft, FileUp, Info, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { MoneyText } from '@/components/MoneyText'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Category } from '@/domain/entities'
import { money, sub } from '@/domain/money'
import { formatShortDate } from '@/lib/dates'
import { cn } from '@/lib/cn'
import type { ParsedStatement } from '../bbva'
import { readStatementPdf } from '../pdfText'
import { useCards, useExpenseCategories } from '../hooks/useImportData'
import {
  buildImportPreview,
  CHARGES_CATEGORY_NAME,
  guessCardFor,
  importCheck,
  importStatement,
  initialChoices,
  isImportable,
  type ImportRow,
  type RowChoice,
  type StatementImportPreview,
} from '../service'

const KIND_LABEL: Record<ImportRow['kind'], string> = { purchase: 'Compra', installment: 'Cuotas', charge: 'Cargo' }

export function ImportStatementPage() {
  const navigate = useNavigate()
  const cards = useCards()
  const categories = useExpenseCategories()
  const fileInput = useRef<HTMLInputElement>(null)
  const [statement, setStatement] = useState<ParsedStatement | null>(null)
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  // '' until the user picks one: then the guess (by account or brand) applies.
  const [chosenCardId, setChosenCardId] = useState('')
  const [preview, setPreview] = useState<StatementImportPreview | null>(null)
  const [choices, setChoices] = useState<Map<string, RowChoice>>(new Map())
  const [importing, setImporting] = useState(false)

  const cardId = chosenCardId || (statement && cards ? (guessCardFor(statement, cards) ?? '') : '')

  async function handleFile(input: HTMLInputElement) {
    const file = input.files?.[0]
    // Cleared so picking the same file again (after a fix, a retry) reads it again.
    input.value = ''
    if (!file) return
    setReading(true)
    setPreview(null)
    try {
      setStatement(await readStatementPdf(file))
      setFileName(file.name)
      setChosenCardId('')
    } catch (error) {
      setStatement(null)
      setFileName('')
      toast.error(error instanceof Error ? error.message : 'No se pudo leer el PDF')
    } finally {
      setReading(false)
    }
  }

  // The proposal depends on what the card already has — rebuilt when the card changes.
  useEffect(() => {
    if (!statement || !cardId) return
    let cancelled = false
    buildImportPreview(statement, cardId)
      .then((built) => {
        if (cancelled) return
        setPreview(built)
        setChoices(initialChoices(built))
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : 'No se pudo armar la vista previa'))
    return () => {
      cancelled = true
    }
  }, [statement, cardId])

  const visiblePreview = preview?.cardId === cardId ? preview : null
  const checks = useMemo(() => (visiblePreview ? importCheck(visiblePreview, choices) : []), [visiblePreview, choices])
  const toImport = visiblePreview?.rows.filter((r) => isImportable(r) && choices.get(r.key)?.include) ?? []

  function updateChoice(key: string, patch: Partial<RowChoice>) {
    setChoices((current) => {
      const next = new Map(current)
      const prev = next.get(key)
      if (prev) next.set(key, { ...prev, ...patch })
      return next
    })
  }

  async function handleImport() {
    if (!visiblePreview) return
    setImporting(true)
    try {
      const result = await importStatement(visiblePreview, choices)
      const parts = [
        result.expenses > 0 && `${result.expenses} gasto${result.expenses === 1 ? '' : 's'}`,
        result.plans > 0 && `${result.plans} compra${result.plans === 1 ? '' : 's'} en cuotas`,
      ].filter(Boolean)
      toast.success(parts.length > 0 ? `Importado: ${parts.join(' y ')}` : 'Fechas del resumen actualizadas')
      if (result.datesSkipped) toast.info('Las fechas del resumen no se cambiaron: ya está pagado en Moneta')
      void navigate(`/tarjetas/${visiblePreview.cardId}?resumen=${visiblePreview.period}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo importar el resumen')
    } finally {
      setImporting(false)
    }
  }

  const newRows = visiblePreview?.rows.filter((r) => r.status === 'new') ?? []
  const loadedRows = visiblePreview?.rows.filter((r) => r.status === 'loaded') ?? []
  const otherRows = visiblePreview?.rows.filter((r) => r.status === 'cancelled' || r.status === 'skipped') ?? []
  const rowProps = { choices, categories: categories ?? [], onChange: updateChoice }

  return (
    <div className="flex flex-col gap-4">
      <Link to="/tarjetas" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Tarjetas
      </Link>
      <PageHeader
        title="Importar resumen"
        description="Subí el PDF del resumen de tu tarjeta (BBVA, Visa o Mastercard). Se lee en tu dispositivo: no sale de él."
      />

      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-2">
            <Label htmlFor="statement-pdf-button">Resumen en PDF</Label>
            {/* Hidden: the button below is the control, so there's a single tab stop. */}
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => void handleFile(e.currentTarget)}
            />
            <Button id="statement-pdf-button" variant="outline" onClick={() => fileInput.current?.click()} disabled={reading}>
              <FileUp className="size-4" />
              {reading ? 'Leyendo…' : fileName ? 'Elegir otro PDF' : 'Elegir PDF'}
            </Button>
            {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
          </div>
          {statement && (
            <div className="flex flex-col gap-2 sm:w-64">
              <Label htmlFor="import-card">Tarjeta</Label>
              {cards && cards.length > 0 ? (
                <Select value={cardId} onValueChange={(v) => v && setChosenCardId(v)}>
                  <SelectTrigger id="import-card" className="w-full">
                    <SelectValue placeholder="Elegí la tarjeta" />
                  </SelectTrigger>
                  <SelectContent>
                    {cards.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Primero{' '}
                  <Link to="/tarjetas" className="underline">
                    creá la tarjeta
                  </Link>
                  .
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {statement && (
        <Card>
          <CardContent className="flex flex-col gap-1 text-sm">
            <p className="font-medium">
              {statement.product ?? 'Resumen'}
              {statement.account && <span className="text-muted-foreground"> · cuenta {statement.account}</span>}
            </p>
            <p className="text-muted-foreground">
              Cerró el {formatShortDate(statement.closeDate)} · vence el {formatShortDate(statement.dueDate)}
              {statement.nextCloseDate && statement.nextDueDate && (
                <>
                  {' '}
                  · el próximo cierra el {formatShortDate(statement.nextCloseDate)} y vence el{' '}
                  {formatShortDate(statement.nextDueDate)}
                </>
              )}
            </p>
          </CardContent>
        </Card>
      )}

      {visiblePreview && (
        <>
          {(['ARS', 'USD'] as const)
            .filter((currency) => visiblePreview.unread[currency] !== 0)
            .map((currency) => (
              <Notice key={`unread-${currency}`} tone="negative">
                No se pudieron leer todas las líneas del PDF: faltan{' '}
                <MoneyText value={money(visiblePreview.unread[currency], currency)} className="font-medium" /> para llegar al
                saldo del resumen. Revisalo antes de importar.
              </Notice>
            ))}
          {visiblePreview.datesLocked && (
            <Notice tone="info">Este resumen (o el siguiente) ya está pagado en Moneta: sus fechas no se cambian.</Notice>
          )}
          {checks.map((check) => {
            const matches = check.bank === check.moneta
            return matches ? (
              <Notice key={check.currency} tone="positive">
                Coincide con el banco: <MoneyText value={money(check.bank, check.currency)} className="font-medium" />
              </Notice>
            ) : (
              <Notice key={check.currency} tone="neutral">
                El banco cobró <MoneyText value={money(check.bank, check.currency)} className="font-medium" /> y Moneta tendría{' '}
                <MoneyText value={money(check.moneta, check.currency)} className="font-medium" /> (diferencia{' '}
                <MoneyText value={sub(money(check.bank, check.currency), money(check.moneta, check.currency))} />
                ). Puede ser un reintegro, algo que destildaste o un gasto de este resumen que el banco no cobró.
              </Notice>
            )
          })}

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Para importar ({newRows.length})</h2>
            {newRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todo lo de este resumen ya está en Moneta.</p>
            ) : (
              <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
                {newRows.map((row) => (
                  <RowItem key={row.key} row={row} {...rowProps} />
                ))}
              </div>
            )}
          </section>

          {loadedRows.length > 0 && (
            <RowGroup title={`Ya están en Moneta (${loadedRows.length})`}>
              {loadedRows.map((row) => (
                <RowItem key={row.key} row={row} {...rowProps} muted />
              ))}
            </RowGroup>
          )}
          {otherRows.length > 0 && (
            <RowGroup title={`No se importan (${otherRows.length})`}>
              {otherRows.map((row) => (
                <RowItem key={row.key} row={row} {...rowProps} muted />
              ))}
            </RowGroup>
          )}

          <div className="flex justify-end">
            <Button onClick={() => void handleImport()} disabled={importing}>
              {toImport.length > 0
                ? `Importar ${toImport.length} movimiento${toImport.length === 1 ? '' : 's'}`
                : 'Guardar las fechas del resumen'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function Notice({ tone, children }: { tone: 'positive' | 'negative' | 'neutral' | 'info'; children: React.ReactNode }) {
  const Icon = tone === 'positive' ? CheckCircle2 : tone === 'info' ? Info : TriangleAlert
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-xl border p-3 text-sm',
        tone === 'positive' && 'border-positive/40 bg-positive/5',
        tone === 'negative' && 'border-negative/40 bg-negative/5',
        (tone === 'neutral' || tone === 'info') && 'border-border bg-muted/40',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : 'text-muted-foreground',
        )}
      />
      <p>{children}</p>
    </div>
  )
}

function RowGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-xl border border-border">
      <summary className="cursor-pointer p-3 text-sm font-medium">{title}</summary>
      <div className="flex flex-col divide-y divide-border border-t border-border">{children}</div>
    </details>
  )
}

interface RowItemProps {
  row: ImportRow
  choices: ReadonlyMap<string, RowChoice>
  categories: readonly Category[]
  onChange: (key: string, patch: Partial<RowChoice>) => void
  /** Already in Moneta or not imported by default: shown dimmed, and
   *  ticked only on purpose ("importar igual"). */
  muted?: boolean
}

function RowItem({ row, choices, categories, onChange, muted = false }: RowItemProps) {
  const choice = choices.get(row.key)
  const importable = isImportable(row)
  const included = importable && (choice?.include ?? false)
  const id = `import-row-${row.key}`
  return (
    <div className={cn('flex flex-col gap-2 p-3 sm:flex-row sm:items-center', muted && !included && 'text-muted-foreground')}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {importable ? (
          <Checkbox
            id={id}
            checked={included}
            onCheckedChange={(checked) => onChange(row.key, { include: checked === true })}
            className="mt-0.5"
            aria-label={muted ? `Importar igual ${row.description}` : `Importar ${row.description}`}
          />
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <label htmlFor={importable ? id : undefined} className={cn('min-w-0 flex-1', importable && 'cursor-pointer')}>
          <span className={cn('flex flex-wrap items-center gap-2 text-sm', !muted && 'font-medium')}>
            {row.description}
            {row.installment && (
              <Badge variant="secondary">
                Cuota {row.installment.number}/{row.installment.count}
              </Badge>
            )}
          </span>
          <span className="block text-xs text-muted-foreground">
            {formatShortDate(row.date)} · {KIND_LABEL[row.kind]}
            {row.installment && row.status === 'new' && ' · se crea la compra en cuotas'}
            {row.note && ` · ${row.note}`}
          </span>
        </label>
        <MoneyText value={money(row.amount, row.currency)} className="shrink-0 text-sm" />
      </div>
      {included && (
        <Select value={choice?.categoryId ?? ''} onValueChange={(v) => v && onChange(row.key, { categoryId: v })}>
          <SelectTrigger className="w-full sm:w-48" aria-label={`Categoría de ${row.description}`}>
            <SelectValue placeholder={row.kind === 'charge' ? `${CHARGES_CATEGORY_NAME} (nueva)` : 'Elegí una categoría'} />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
