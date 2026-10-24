import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import type { Account, Category, CreditCard } from '@/domain/entities'
import { formatMonthLabel, formatShortDate } from '@/lib/dates'
import { CURRENCIES } from '@/domain/money'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CSV_DATE_FORMATS, type CsvDateFormat } from '../dateFormats'
import { CSV_ENCODINGS, type CsvEncoding } from '../parse'
import { CSV_IMPORT_CURRENCIES, type CsvMapping } from '../schema'
import type { StatementChoice } from '../service'

interface ColumnOption {
  index: number
  label: string
}

interface UploadStepProps {
  mapping: CsvMapping
  setMapping: React.Dispatch<React.SetStateAction<CsvMapping>>
  columns: ColumnOption[]
  expenseCategories: Category[] | undefined
  targets: { accounts: Account[]; cards: CreditCard[]; incomeCategories: Category[] } | undefined
  statementChoices: StatementChoice[] | undefined
  hasFile: boolean
  rowCount: number
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onEncodingChange: (encoding: CsvEncoding) => void
  onContinue: () => void
  isBusy: boolean
}

const NO_DESTINATION = 'none'
const AUTO_PERIOD = '__auto__'
const NO_INCOME = '__none__'

function ColumnSelect({
  label,
  columns,
  value,
  onChange,
}: {
  label: string
  columns: ColumnOption[]
  value: number
  onChange: (index: number) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Elegí una columna" />
        </SelectTrigger>
        <SelectContent>
          {columns.map((col) => (
            <SelectItem key={col.index} value={String(col.index)}>
              {col.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function UploadStep({
  mapping,
  setMapping,
  columns,
  expenseCategories,
  targets,
  statementChoices,
  hasFile,
  rowCount,
  onFileChange,
  onEncodingChange,
  onContinue,
  isBusy,
}: UploadStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const { destination } = mapping
  const importsCredits = destination.kind === 'account' && destination.incomeCategoryId !== ''
  const creditNote = importsCredits ? 'se importan como ingresos' : 'no se importan'
  const destinationValue =
    destination.kind === 'account'
      ? `account:${destination.accountId}`
      : destination.kind === 'card'
        ? `card:${destination.cardId}`
        : NO_DESTINATION

  function handleDestinationChange(value: string) {
    // Radix fires '' when the select remounts.
    if (value === '') return
    const [kind, id = ''] = value.split(':')
    if (kind === 'account') {
      const account = targets?.accounts.find((a) => a.id === id)
      // A debit is in the account's currency: the statement too.
      setMapping((m) => ({
        ...m,
        destination: { kind: 'account', accountId: id, incomeCategoryId: '' },
        ...(account && { currency: account.currency }),
      }))
    } else if (kind === 'card') {
      setMapping((m) => ({ ...m, destination: { kind: 'card', cardId: id, statementPeriod: '' } }))
    } else {
      setMapping((m) => ({ ...m, destination: { kind: 'none' } }))
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setFileName(event.target.files?.[0]?.name ?? null)
    onFileChange(event)
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Archivo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="csv-file">Extracto (CSV)</Label>
              <div className="flex items-center gap-2">
                <Button
                  id="csv-file"
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="size-4" />
                  Elegir archivo
                </Button>
                <span className="truncate text-sm text-muted-foreground">
                  {fileName ?? 'Ningún archivo elegido'}
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Codificación</Label>
              <Select value={mapping.encoding} onValueChange={(v) => onEncodingChange(v as CsvEncoding)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CSV_ENCODINGS.map((enc) => (
                    <SelectItem key={enc.value} value={enc.value}>
                      {enc.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {hasFile && (
            <>
              <div className="flex items-center gap-2">
                <Switch
                  id="has-header"
                  checked={mapping.hasHeaderRow}
                  onCheckedChange={(checked) => setMapping((m) => ({ ...m, hasHeaderRow: checked }))}
                />
                <Label htmlFor="has-header">La primera fila es encabezado</Label>
              </div>
              <p className="text-xs text-muted-foreground">{rowCount} fila{rowCount === 1 ? '' : 's'} de datos detectada{rowCount === 1 ? '' : 's'}.</p>
            </>
          )}
        </CardContent>
      </Card>

      {hasFile && columns.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Destino</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>¿De dónde es el extracto?</Label>
                <Select value={destinationValue} onValueChange={handleDestinationChange}>
                  <SelectTrigger className="w-full" aria-label="Destino">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DESTINATION}>Sin cuenta ni tarjeta (sólo gastos)</SelectItem>
                    {targets?.accounts.map((a) => (
                      <SelectItem key={a.id} value={`account:${a.id}`}>
                        Cuenta {a.name} · {a.currency}
                      </SelectItem>
                    ))}
                    {targets?.cards.map((c) => (
                      <SelectItem key={c.id} value={`card:${c.id}`}>
                        Tarjeta {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {destination.kind === 'account'
                    ? 'Los gastos salen de la cuenta (débito).'
                    : destination.kind === 'card'
                      ? 'Los gastos entran a los resúmenes de la tarjeta.'
                      : 'Los gastos no tocan ninguna cuenta.'}
                </p>
              </div>
              {destination.kind === 'account' && (
                <div className="flex flex-col gap-1.5">
                  <Label>Créditos (plata que entró)</Label>
                  <Select
                    value={destination.incomeCategoryId || NO_INCOME}
                    onValueChange={(v) => {
                      if (v === '') return
                      setMapping((m) =>
                        m.destination.kind === 'account'
                          ? { ...m, destination: { ...m.destination, incomeCategoryId: v === NO_INCOME ? '' : v } }
                          : m,
                      )
                    }}
                  >
                    <SelectTrigger className="w-full" aria-label="Categoría de ingreso">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_INCOME}>No importarlos</SelectItem>
                      {targets?.incomeCategories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          Como ingresos · {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {targets?.incomeCategories.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Para importarlos, creá una categoría de ingreso en Ajustes → Categorías.
                    </p>
                  )}
                </div>
              )}
              {destination.kind === 'card' && (
                <div className="flex flex-col gap-1.5">
                  <Label>Resumen</Label>
                  <Select
                    value={destination.statementPeriod || AUTO_PERIOD}
                    onValueChange={(v) => {
                      if (v === '') return
                      setMapping((m) =>
                        m.destination.kind === 'card'
                          ? { ...m, destination: { ...m.destination, statementPeriod: v === AUTO_PERIOD ? '' : v } }
                          : m,
                      )
                    }}
                  >
                    <SelectTrigger className="w-full" aria-label="Resumen">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO_PERIOD}>Según la fecha de cada gasto</SelectItem>
                      {statementChoices?.map((c) => (
                        // A paid statement only changes by undoing its payment.
                        <SelectItem key={c.period} value={c.period} disabled={c.paid}>
                          Todos al de {formatMonthLabel(c.period).toLowerCase()}{' '}
                          {c.paid ? '(pagado)' : `(cierra el ${formatShortDate(c.closeDate)})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Si es el CSV del resumen del banco, elegí ese resumen: incluye compras presentadas tarde.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Moneda y categoría</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Moneda</Label>
                <Select
                  value={mapping.currency}
                  disabled={destination.kind === 'account'}
                  onValueChange={(v) => setMapping((m) => ({ ...m, currency: v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CSV_IMPORT_CURRENCIES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code} · {CURRENCIES[code]?.symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {destination.kind === 'account' && (
                  <p className="text-xs text-muted-foreground">Es la moneda de la cuenta.</p>
                )}
                {destination.kind === 'card' && (
                  <p className="text-xs text-muted-foreground">
                    Un resumen en pesos y dólares se importa en dos archivos, uno por moneda.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Categoría para los gastos</Label>
                <Select
                  value={mapping.categoryId}
                  onValueChange={(v) => setMapping((m) => ({ ...m, categoryId: v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Elegí una categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {expenseCategories?.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Columnas</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <ColumnSelect
                  label="Fecha"
                  columns={columns}
                  value={mapping.dateColumn}
                  onChange={(index) => setMapping((m) => ({ ...m, dateColumn: index }))}
                />
                <div className="flex flex-col gap-1.5">
                  <Label>Formato de fecha</Label>
                  <Select
                    value={mapping.dateFormat}
                    onValueChange={(v) => setMapping((m) => ({ ...m, dateFormat: v as CsvDateFormat }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CSV_DATE_FORMATS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <ColumnSelect
                  label="Descripción"
                  columns={columns}
                  value={mapping.descriptionColumn}
                  onChange={(index) => setMapping((m) => ({ ...m, descriptionColumn: index }))}
                />
              </div>

              <div className="flex flex-col gap-3">
                <Label>Monto</Label>
                <Tabs
                  value={mapping.amount.mode}
                  onValueChange={(v) =>
                    setMapping((m) => ({
                      ...m,
                      // Reuse the column the user already picked instead of
                      // resetting to 0/1 — switching modes shouldn't throw
                      // away a selection that's still meaningful.
                      amount:
                        v === 'single'
                          ? {
                              mode: 'single',
                              amountColumn: m.amount.mode === 'debit-credit' ? m.amount.debitColumn : 0,
                              signConvention: 'positive-is-expense',
                            }
                          : {
                              mode: 'debit-credit',
                              debitColumn: m.amount.mode === 'single' ? m.amount.amountColumn : 0,
                              creditColumn: m.amount.mode === 'single' ? m.amount.amountColumn : 1,
                            },
                    }))
                  }
                >
                  <TabsList>
                    <TabsTrigger value="single">Una columna con signo</TabsTrigger>
                    <TabsTrigger value="debit-credit">Débito y crédito separados</TabsTrigger>
                  </TabsList>
                </Tabs>

                {mapping.amount.mode === 'single' ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ColumnSelect
                      label="Columna de monto"
                      columns={columns}
                      value={mapping.amount.amountColumn}
                      onChange={(index) =>
                        setMapping((m) =>
                          m.amount.mode === 'single' ? { ...m, amount: { ...m.amount, amountColumn: index } } : m,
                        )
                      }
                    />
                    <div className="flex flex-col gap-1.5">
                      <Label>¿Qué significa un monto positivo?</Label>
                      <Select
                        value={mapping.amount.signConvention}
                        onValueChange={(v) =>
                          setMapping((m) =>
                            m.amount.mode === 'single'
                              ? { ...m, amount: { ...m.amount, signConvention: v as 'positive-is-income' | 'positive-is-expense' } }
                              : m,
                          )
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="positive-is-expense">Positivo = gasto</SelectItem>
                          <SelectItem value="positive-is-income">Positivo = ingreso ({creditNote})</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ColumnSelect
                      label="Columna de débito (gastos)"
                      columns={columns}
                      value={mapping.amount.debitColumn}
                      onChange={(index) =>
                        setMapping((m) =>
                          m.amount.mode === 'debit-credit' ? { ...m, amount: { ...m.amount, debitColumn: index } } : m,
                        )
                      }
                    />
                    <ColumnSelect
                      label={`Columna de crédito (${creditNote})`}
                      columns={columns}
                      value={mapping.amount.creditColumn}
                      onChange={(index) =>
                        setMapping((m) =>
                          m.amount.mode === 'debit-credit' ? { ...m, amount: { ...m.amount, creditColumn: index } } : m,
                        )
                      }
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={onContinue} disabled={isBusy}>
              <Upload className="size-4" />
              Ver vista previa
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
