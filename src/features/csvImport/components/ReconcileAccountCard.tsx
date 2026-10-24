import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DateField } from '@/components/DateField'
import { MoneyText } from '@/components/MoneyText'
import type { Account } from '@/domain/entities'
import { formatMoney, sub, tryParseAmount } from '@/domain/money'
import { formatFullDate, type DateStamp } from '@/lib/dates'
import { useAccountBalanceAt } from '../hooks/useAccountBalanceAt'
import { reconcileAccount } from '../service'

interface ReconcileAccountCardProps {
  account: Account
  /** The last date of the imported statement. */
  defaultDate: DateStamp
}

/** After importing a bank statement into an account: compare the balance
 *  Moneta computes with the one the statement shows, and register the
 *  difference as an adjustment ("Ajustar saldo") if they don't match. */
export function ReconcileAccountCard({ account, defaultDate }: ReconcileAccountCardProps) {
  const [date, setDate] = useState<DateStamp>(defaultDate)
  const [bankBalance, setBankBalance] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const moneta = useAccountBalanceAt(account.id, date)
  // A balance can be zero or negative, unlike an amount.
  const bank = tryParseAmount(bankBalance, account.currency)
  const difference = bank && moneta ? sub(bank, moneta) : undefined

  async function handleAdjust() {
    setIsSaving(true)
    try {
      const adjusted = await reconcileAccount(account.id, date, bankBalance)
      toast.success(adjusted ? `Ajuste registrado: ${formatMoney(adjusted)}` : 'El saldo ya coincidía con el banco')
      setBankBalance('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar el ajuste')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Conciliar {account.name} con el extracto</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reconcile-date">Saldo al final del día</Label>
            <DateField id="reconcile-date" value={date} onChange={setDate} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bank-balance">Saldo según el banco ({account.currency})</Label>
            <Input
              id="bank-balance"
              inputMode="decimal"
              placeholder="0,00"
              value={bankBalance}
              onChange={(event) => setBankBalance(event.target.value)}
            />
          </div>
        </div>
        <div className="text-sm">
          {!date ? (
            <p className="text-muted-foreground">Elegí la fecha del saldo del extracto.</p>
          ) : moneta === null ? (
            <p className="text-muted-foreground">
              La cuenta empieza el {formatFullDate(account.openingDate)}: elegí una fecha posterior.
            </p>
          ) : (
            moneta && (
              <p>
                Saldo en Moneta al {formatFullDate(date)}: <MoneyText value={moneta} className="font-medium" />
              </p>
            )
          )}
          {difference && difference.amount === 0 && <p className="font-medium text-positive">Coincide con el banco.</p>}
          {/[()]/.test(bankBalance) && (
            <p className="text-negative">Escribí un saldo negativo con signo menos, no entre paréntesis.</p>
          )}
          {difference && difference.amount !== 0 && (
            <p className="font-medium text-negative">
              Diferencia: <MoneyText value={difference} /> — falta registrar algo (intereses, comisiones, un movimiento
              que no estaba en el extracto) o hay algo de más.
            </p>
          )}
        </div>
        {difference && difference.amount !== 0 && (
          <div>
            <Button onClick={() => void handleAdjust()} disabled={isSaving}>
              Registrar ajuste por la diferencia
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
