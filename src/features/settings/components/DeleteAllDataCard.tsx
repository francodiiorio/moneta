import { useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { deleteAllData } from '../service'

/** What the user types to confirm — a click alone never erases everything. */
const CONFIRM_WORD = 'BORRAR'

export function DeleteAllDataCard() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  function handleOpenChange(next: boolean) {
    if (isDeleting) return
    setOpen(next)
    if (!next) setTyped('')
  }

  async function handleDelete() {
    setIsDeleting(true)
    try {
      await deleteAllData()
      // A full reload, not a navigation: the app reseeds its default
      // categories on start, and every in-memory UI state starts fresh.
      window.location.assign('/')
    } catch (error) {
      console.error('No se pudieron borrar los datos', error)
      toast.error('No se pudieron borrar los datos — no se modificó nada')
      setIsDeleting(false)
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Borrar todos los datos</CardTitle>
        <CardDescription>
          Deja la app como recién instalada en este navegador. Si querés conservar algo, exportá un backup antes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 className="size-4" />
          Borrar todos los datos
        </Button>
      </CardContent>

      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar todos los datos?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran tus cuentas, movimientos, tarjetas y resúmenes, planes, presupuestos, ahorros, inversiones,
              categorías y ajustes guardados en este navegador (el modo claro u oscuro se mantiene). No se puede
              deshacer: sólo un backup exportado antes los puede recuperar. Si tenés Moneta abierta en otra pestaña,
              también se reinicia.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-delete">Escribí {CONFIRM_WORD} para confirmar</Label>
            <Input
              id="confirm-delete"
              // Safe to focus: Enter submits nothing, and the word still has to be typed.
              autoFocus
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            {/* A plain Button, not AlertDialogAction: that one closes the
                dialog on click, before the erase finishes or fails. */}
            <Button
              variant="destructive"
              aria-busy={isDeleting}
              // Case and surrounding spaces don't matter: typing the word is the
              // deliberate act, not matching it exactly.
              disabled={typed.trim().toUpperCase() !== CONFIRM_WORD || isDeleting}
              onClick={() => void handleDelete()}
            >
              {isDeleting ? 'Borrando…' : 'Borrar todo'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
