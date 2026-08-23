import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Download, Upload } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
import { importBackup, peekIsEncrypted } from '../import'

const MIN_PASSPHRASE_LENGTH = 8

export function BackupCard() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isBusy, setIsBusy] = useState(false)

  const [encryptOnExport, setEncryptOnExport] = useState(false)
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [exportPassphraseConfirm, setExportPassphraseConfirm] = useState('')

  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingFileEncrypted, setPendingFileEncrypted] = useState(false)
  const [importPassphrase, setImportPassphrase] = useState('')

  function resetExportPassphrase() {
    setEncryptOnExport(false)
    setExportPassphrase('')
    setExportPassphraseConfirm('')
  }

  async function handleExport() {
    if (encryptOnExport) {
      if (exportPassphrase.length < MIN_PASSPHRASE_LENGTH) {
        toast.error(`La contraseña tiene que tener al menos ${MIN_PASSPHRASE_LENGTH} caracteres`)
        return
      }
      if (exportPassphrase !== exportPassphraseConfirm) {
        toast.error('Las contraseñas no coinciden')
        return
      }
    }

    setIsBusy(true)
    try {
      const backup = await exportBackup(encryptOnExport ? exportPassphrase : undefined)
      downloadBackup(backup)
      toast.success('Backup exportado')
      resetExportPassphrase()
    } catch {
      toast.error('No se pudo exportar el backup')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPendingFile(file)
    setPendingFileEncrypted(await peekIsEncrypted(file))
    setImportPassphrase('')
  }

  function closeImportDialog() {
    setPendingFile(null)
    setPendingFileEncrypted(false)
    setImportPassphrase('')
  }

  async function confirmImport() {
    if (!pendingFile) return

    setIsBusy(true)
    try {
      // Safety net: snapshot current state before it gets replaced. Never
      // encrypted — it has to be openable without remembering a second
      // passphrase in the middle of recovering from a bad import.
      const safety = await exportBackup()
      downloadBackup({
        ...safety,
        filename: safety.filename.replace('.finance', '-antes-de-importar.finance'),
      })

      const result = await importBackup(pendingFile, pendingFileEncrypted ? importPassphrase : undefined)
      if (!result.checksumMatched) {
        toast.warning(
          'Backup importado, pero el checksum no coincide (el archivo pudo haber sido editado).',
        )
      } else {
        toast.success('Backup importado')
      }
      closeImportDialog()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo importar el backup')
    } finally {
      setIsBusy(false)
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
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id="encrypt-export"
            checked={encryptOnExport}
            onCheckedChange={(checked) => {
              setEncryptOnExport(checked)
              if (!checked) {
                setExportPassphrase('')
                setExportPassphraseConfirm('')
              }
            }}
          />
          <Label htmlFor="encrypt-export">Cifrar con contraseña</Label>
        </div>

        {encryptOnExport && (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">
              Si perdés esta contraseña, el backup queda inservible — no hay forma de recuperarlo.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="export-passphrase">Contraseña</Label>
                <Input
                  id="export-passphrase"
                  type="password"
                  value={exportPassphrase}
                  onChange={(e) => setExportPassphrase(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="export-passphrase-confirm">Confirmar contraseña</Label>
                <Input
                  id="export-passphrase-confirm"
                  type="password"
                  value={exportPassphraseConfirm}
                  onChange={(e) => setExportPassphraseConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => void handleExport()} disabled={isBusy}>
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
            onChange={(e) => void handleFileSelected(e)}
          />
        </div>
      </CardContent>

      <AlertDialog open={!!pendingFile} onOpenChange={(open) => !open && closeImportDialog()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Importar este backup?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3">
                <p>
                  Esto reemplaza todos los datos actuales de la app por los del archivo{' '}
                  <span className="font-medium">{pendingFile?.name}</span>. Antes de importar se
                  descarga automáticamente un backup de seguridad del estado actual.
                </p>
                {pendingFileEncrypted && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="import-passphrase" className="text-foreground">
                      Este backup está cifrado — ingresá la contraseña
                    </Label>
                    <Input
                      id="import-passphrase"
                      type="password"
                      value={importPassphrase}
                      onChange={(e) => setImportPassphrase(e.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isBusy || (pendingFileEncrypted && importPassphrase.length === 0)}
              onClick={() => void confirmImport()}
            >
              Importar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
