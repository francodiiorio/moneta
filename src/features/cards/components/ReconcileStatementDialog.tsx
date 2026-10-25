import { useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MoneyText } from '@/components/MoneyText'
import { statementDifferences } from '@/domain/cards'
import { formatAmountInput, money, negate, type Money } from '@/domain/money'
import { formatMonthLabel } from '@/lib/dates'
import { useDialogSession } from '../hooks/useDialogSession'
import { useExpenseCategories } from '../hooks/useExpenseCategories'
import {
  parseBankTotals,
  RECONCILE_DESCRIPTION,
  reconcileCurrencies,
  reconcileStatementFromForm,
  type StatementView,
} from '../service'

interface ReconcileStatementDialogProps {
  cardId: string
  cardName: string
  /** The statement to reconcile; the dialog is open while set. */
  statement: StatementView | undefined
  /** Prefills the bank's totals — what was paid, when reconciling a
   *  statement paid with a difference. */
  bankTotals?: readonly Money[]
  onOpenChange: (open: boolean) => void
}

export function ReconcileStatementDialog({ cardId, cardName, statement, bankTotals, onOpenChange }: ReconcileStatementDialogProps) {
  const session = useDialogSession(statement)
  return (
    <Dialog open={!!statement} onOpenChange={onOpenChange}>
      <DialogContent>
        {session && (
          <DialogBody
            key={session.key}
            cardId={cardId}
            cardName={cardName}
            statement={session.value}
            initialBankTotals={bankTotals ?? []}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

interface DialogBodyProps {
  cardId: string
  cardName: string
  statement: StatementView
  initialBankTotals: readonly Money[]
  onClose: () => void
}

function DialogBody({ cardId, cardName, statement, initialBankTotals, onClose }: DialogBodyProps) {
  // `statement` is pinned when opening: the differences are against these
  // totals, and the repository rejects the write if the real ones changed.
  const categories = useExpenseCategories()
  const [lines, setLines] = useState(() =>
    reconcileCurrencies([...statement.totals, ...initialBankTotals]).map((currency) => {
      const known = initialBankTotals.find((b) => b.currency === currency)
      return { currency, bankTotal: known ? formatAmountInput(known) : '' }
    }),
  )
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const bankTotals = parseBankTotals(lines)
  const differences = statementDifferences(statement.totals, bankTotals)
  const differenceOf = (currency: string) => differences.find((d) => d.currency === currency)
  const owedMore = differences.filter((d) => d.amount > 0)
  const owedLess = differences.filter((d) => d.amount < 0)
  const allMatch = differences.length > 0 && owedMore.length === 0 && owedLess.length === 0

  async function handleSave() {
    if (!categoryId) {
      toast.error('Elegí una categoría para la diferencia')
      return
    }
    setIsSaving(true)
    try {
      const created = await reconcileStatementFromForm(cardId, statement.period, { lines, categoryId, description }, statement.totals)
      toast.success(created === 1 ? 'Se registró la diferencia como gasto' : `Se registraron ${created} diferencias como gastos`)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar la diferencia')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Conciliar {cardName} · {formatMonthLabel(statement.period).toLowerCase()}
        </DialogTitle>
        <DialogDescription>
          Cargá el total que muestra el resumen del banco en cada moneda y compará con el de Moneta. Dejá en blanco una
          moneda que el resumen no tenga.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        {lines.map((line, index) => {
          const total = statement.totals.find((t) => t.currency === line.currency) ?? money(0, line.currency)
          const difference = differenceOf(line.currency)
          return (
            <div key={line.currency} className="grid grid-cols-2 items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`bank-${line.currency}`}>Total del banco ({line.currency})</Label>
                <Input
                  id={`bank-${line.currency}`}
                  inputMode="decimal"
                  placeholder="0,00"
                  value={line.bankTotal}
                  onChange={(event) => {
                    const bankTotal = event.target.value
                    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, bankTotal } : l)))
                  }}
                />
              </div>
              <div className="pb-2 text-xs text-muted-foreground">
                <p>
                  Moneta: <MoneyText value={total} />
                </p>
                {difference && difference.amount !== 0 && (
                  <p className="font-medium text-negative">
                    El banco cobra{' '}
                    <MoneyText value={difference.amount > 0 ? difference : negate(difference)} />
                    {difference.amount > 0 ? ' más' : ' menos'}
                  </p>
                )}
                {difference?.amount === 0 && <p className="font-medium text-positive">Coincide</p>}
              </div>
            </div>
          )
        })}
      </div>

      {allMatch && <p className="text-sm">El resumen coincide con el banco: ya lo podés pagar.</p>}

      {owedLess.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Si el banco cobra menos, puede ser un gasto que el comercio presenta en el resumen siguiente (editalo y fijalo
          en ese resumen) o un reintegro o bonificación del banco.
        </p>
      )}

      {owedMore.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <p className="text-sm">
            Lo que el banco cobra de más (impuestos, intereses, comisiones o un gasto que no cargaste) se puede registrar
            como un gasto de este resumen.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Categoría</Label>
              <Select
                value={categoryId}
                onValueChange={(next) => {
                  // Radix fires '' when the select remounts.
                  if (next !== '') setCategoryId(next)
                }}
              >
                <SelectTrigger className="w-full" aria-label="Categoría">
                  <SelectValue placeholder="Elegí una categoría" />
                </SelectTrigger>
                <SelectContent>
                  {categories?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reconcile-description">Descripción</Label>
              <Input
                id="reconcile-description"
                maxLength={120}
                placeholder={RECONCILE_DESCRIPTION}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {owedMore.length > 0 ? 'Cancelar' : 'Cerrar'}
        </Button>
        {owedMore.length > 0 && (
          <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
            Registrar diferencia
          </Button>
        )}
      </DialogFooter>
    </>
  )
}
