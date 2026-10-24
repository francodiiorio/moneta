import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ChevronLeft } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { csvMappingSchema, type CsvMapping } from '../schema'
import { parseCsvFile, type CsvEncoding } from '../parse'
import { importSelectedRows, lastStatementDate, prepareImport, type PreviewRow } from '../service'
import { useExpenseCategories } from '../hooks/useExpenseCategories'
import { useCardStatementChoices, useImportTargets } from '../hooks/useImportTargets'
import { UploadStep } from '../components/UploadStep'
import { PreviewTable } from '../components/PreviewTable'
import { ReconcileAccountCard } from '../components/ReconcileAccountCard'
import { Button } from '@/components/ui/button'
import type { DateStamp } from '@/lib/dates'

function defaultMapping(): CsvMapping {
  return {
    destination: { kind: 'none' },
    categoryId: '',
    currency: 'ARS',
    hasHeaderRow: true,
    encoding: 'utf-8',
    dateFormat: 'dd/MM/yyyy',
    dateColumn: 0,
    descriptionColumn: 1,
    amount: { mode: 'single', amountColumn: 2, signConvention: 'positive-is-expense' },
  }
}

export function ImportCsvPage() {
  const navigate = useNavigate()
  const expenseCategories = useExpenseCategories()
  const targets = useImportTargets()

  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload')
  const [result, setResult] = useState<{ expenses: number; incomes: number; lastDate: DateStamp | undefined }>()
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<string[][]>([])
  // Plain useState instead of react-hook-form here, deliberately: every
  // field is a Select/Switch with a constrained set of valid values (no
  // free-text input needing per-field inline validation UX), and the
  // `amount` field is a Zod discriminated union that's awkward to bind
  // through react-hook-form's flat-path FormField. Validated as a whole
  // with csvMappingSchema right before use instead.
  const [mapping, setMapping] = useState<CsvMapping>(defaultMapping())
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [isBusy, setIsBusy] = useState(false)
  const statementChoices = useCardStatementChoices(
    mapping.destination.kind === 'card' ? mapping.destination.cardId : undefined,
  )

  async function reparse(nextFile: File, encoding: CsvEncoding) {
    try {
      setRows(await parseCsvFile(nextFile, encoding))
    } catch {
      toast.error('No se pudo leer el archivo — confirmá que es un CSV válido')
      setRows([])
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile) return
    setFile(selectedFile)
    await reparse(selectedFile, mapping.encoding)
  }

  async function handleEncodingChange(encoding: CsvEncoding) {
    setMapping((m) => ({ ...m, encoding }))
    if (file) await reparse(file, encoding)
  }

  const columns =
    rows.length === 0
      ? []
      : (rows[0] ?? []).map((cell, i) => ({
          index: i,
          label: mapping.hasHeaderRow && cell.trim() ? cell.trim() : `Columna ${i + 1}`,
        }))
  const rowCount = rows.length === 0 ? 0 : mapping.hasHeaderRow ? rows.length - 1 : rows.length

  async function handleContinue() {
    const parsed = csvMappingSchema.safeParse(mapping)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Revisá el mapeo de columnas')
      return
    }
    setIsBusy(true)
    try {
      const built = await prepareImport(rows, parsed.data)
      setPreview(built)
      setSelected(new Set(built.filter((r) => r.defaultSelected).map((r) => r.index)))
      setStep('preview')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo procesar el archivo')
    } finally {
      setIsBusy(false)
    }
  }

  function toggleRow(index: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function handleImport() {
    setIsBusy(true)
    try {
      const rowsToImport = preview.filter((r) => selected.has(r.index))
      const imported = await importSelectedRows(rowsToImport, mapping)
      if (mapping.destination.kind !== 'account') {
        toast.success(`Se importaron ${imported.imported} movimiento${imported.imported === 1 ? '' : 's'}`)
        void navigate('/movimientos')
        return
      }
      // Into an account: offer reconciling against the statement's balance,
      // at the file's last date (skipped duplicates count: Moneta has them).
      setResult({ expenses: imported.expenses, incomes: imported.incomes, lastDate: lastStatementDate(preview) })
      setStep('done')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo importar')
    } finally {
      setIsBusy(false)
    }
  }

  function startOver() {
    setFile(null)
    setRows([])
    setPreview([])
    setSelected(new Set())
    setResult(undefined)
    setStep('upload')
  }

  const { destination } = mapping
  const importAccount =
    destination.kind === 'account' ? targets?.accounts.find((a) => a.id === destination.accountId) : undefined
  const selectedCount = preview.filter((r) => selected.has(r.index)).length
  const duplicateCount = preview.filter((r) => r.status === 'duplicate').length
  const invalidCount = preview.filter((r) => r.status === 'invalid').length
  const excludedCount = preview.filter((r) => r.status === 'excluded').length

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/movimientos"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Movimientos
      </Link>

      <PageHeader
        title="Importar CSV"
        description="Cargá un extracto del banco o de la tarjeta y creá los movimientos en bloque."
      />

      {step === 'upload' ? (
        <UploadStep
          mapping={mapping}
          setMapping={setMapping}
          columns={columns}
          expenseCategories={expenseCategories}
          targets={targets}
          statementChoices={statementChoices}
          hasFile={!!file}
          rowCount={rowCount}
          onFileChange={(e) => void handleFileChange(e)}
          onEncodingChange={(enc) => void handleEncodingChange(enc)}
          onContinue={() => void handleContinue()}
          isBusy={isBusy}
        />
      ) : step === 'done' ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            Se importaron {result?.expenses ?? 0} gasto{result?.expenses === 1 ? '' : 's'} y {result?.incomes ?? 0} ingreso
            {result?.incomes === 1 ? '' : 's'}.
          </p>
          {importAccount && result?.lastDate && <ReconcileAccountCard account={importAccount} defaultDate={result.lastDate} />}
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/movimientos">Ir a Movimientos</Link>
            </Button>
            <Button variant="ghost" onClick={startOver}>
              Importar otro archivo
            </Button>
          </div>
        </div>
      ) : (
        <PreviewTable
          rows={preview}
          selected={selected}
          onToggle={toggleRow}
          selectedCount={selectedCount}
          duplicateCount={duplicateCount}
          invalidCount={invalidCount}
          excludedCount={excludedCount}
          {...(destination.kind === 'account' && {
            notice:
              'Los pagos de tarjeta y las transferencias entre tus cuentas no son gastos ni ingresos: si ya los cargaste en Moneta aparecen como duplicados; si no, destildalos y registralos con "Pagar resumen" o como transferencia.',
          })}
          onBack={() => setStep('upload')}
          onImport={() => void handleImport()}
          isBusy={isBusy}
        />
      )}
    </div>
  )
}
