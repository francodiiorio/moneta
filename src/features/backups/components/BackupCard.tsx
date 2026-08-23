import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Download, Upload } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { downloadBackup, exportBackup } from '../export'
import { importBackup } from '../import'

export function BackupCard() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  async function handleExport() {
    setIsBusy(true)
    try {
      const backup = await exportBackup()
      downloadBackup(backup)
      toast.success('Backup exportado')
    } catch {
      toast.error('No se pudo exportar el backup')
    } finally {
      setIsBusy(false)
    }
  }

  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) setPendingFile(file)
    event.target.value = ''
  }

  async function confirmImport() {
    if (!pendingFile) return
    setIsBusy(true)
    try {
      // Safety net: snapshot current state before it gets replaced.
      const safety = await exportBackup()
      downloadBackup({
        ...safety,
        filename: safety.filename.replace('.finance', '-antes-de-importar.finance'),
      })

      const result = await importBackup(pendingFile)
      if (!result.checksumMatched) {
        toast.warning(
          'Backup importado, pero el checksum no coincide (el archivo pudo haber sido editado).',
        )
      } else {
        toast.success('Backup importado')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo importar el backup')
    } finally {
      setIsBusy(false)
      setPendingFile(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backup</CardTitle>
        <CardDescription>
          Tus datos viven solo en este dispositivo. Exportá un backup periódicamente para no
          perderlos.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={handleExport} disabled={isBusy}>
          <Download className="size-4" />
          Exportar backup
        </Button>

        <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
          <Upload className="size-4" />
          Importar backup
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".finance,application/json"
          className="hidden"
          onChange={handleFileSelected}
        />
      </CardContent>

      <AlertDialog open={!!pendingFile} onOpenChange={(open) => !open && setPendingFile(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Importar este backup?</AlertDialogTitle>
            <AlertDialogDescription>
              Esto reemplaza todos los datos actuales de la app por los del archivo{' '}
              <span className="font-medium">{pendingFile?.name}</span>. Antes de importar se
              descarga automáticamente un backup de seguridad del estado actual.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmImport}>Importar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
