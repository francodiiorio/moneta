import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import type { AccountWithBalance } from '@/database/repositories/accounts.repo'
import type { Category } from '@/domain/entities'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CSV_DATE_FORMATS, type CsvDateFormat } from '../dateFormats'
import { CSV_ENCODINGS, type CsvEncoding } from '../parse'
import type { CsvMapping } from '../schema'

interface ColumnOption {
  index: number
  label: string
}

interface UploadStepProps {
  mapping: CsvMapping
  setMapping: React.Dispatch<React.SetStateAction<CsvMapping>>
  columns: ColumnOption[]
  accounts: AccountWithBalance[] | undefined
  expenseCategories: Category[] | undefined
  incomeCategories: Category[] | undefined
  hasFile: boolean
  rowCount: number
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onEncodingChange: (encoding: CsvEncoding) => void
  onContinue: () => void
  isBusy: boolean
}

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
  accounts,
  expenseCategories,
  incomeCategories,
  hasFile,
  rowCount,
  onFileChange,
  onEncodingChange,
  onContinue,
  isBusy,
}: UploadStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)

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
              <CardTitle className="text-base">Cuenta y categorías</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label>Cuenta destino</Label>
                <Select value={mapping.accountId} onValueChange={(v) => setMapping((m) => ({ ...m, accountId: v }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Elegí una cuenta" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts?.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Categoría para gastos</Label>
                <Select
                  value={mapping.expenseCategoryId}
                  onValueChange={(v) => setMapping((m) => ({ ...m, expenseCategoryId: v }))}
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
              <div className="flex flex-col gap-1.5">
                <Label>Categoría para ingresos</Label>
                <Select
                  value={mapping.incomeCategoryId}
                  onValueChange={(v) => setMapping((m) => ({ ...m, incomeCategoryId: v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Elegí una categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {incomeCategories?.map((category) => (
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
                              signConvention: 'positive-is-income',
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
                          <SelectItem value="positive-is-income">Positivo = ingreso</SelectItem>
                          <SelectItem value="positive-is-expense">Positivo = gasto</SelectItem>
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
                      label="Columna de crédito (ingresos)"
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
