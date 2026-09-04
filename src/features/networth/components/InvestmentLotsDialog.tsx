import { useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { MoneyText } from '@/components/MoneyText'
import { formatQuantity, quantity } from '@/domain/decimal'
import { money } from '@/domain/money'
import { formatFullDate } from '@/lib/dates'
import type { InvestmentAsset, InvestmentLot } from '@/domain/entities'
import { useInvestmentLots } from '../hooks/useInvestmentLots'
import { deleteInvestmentLot } from '../service'
import { InvestmentLotFormDialog } from './InvestmentLotFormDialog'

interface InvestmentLotsDialogProps {
  /** The position whose purchases are being managed — null closes the dialog. */
  asset: InvestmentAsset | null
  assets: InvestmentAsset[] | undefined
  onOpenChange: (open: boolean) => void
}

/** "Editar posición" from InvestmentRow opens this instead of a direct
 *  quantity/cost form — una posición es la suma de sus compras
 *  (InvestmentLot), nunca algo que se edite directo. Ver ADR "Tracking
 *  de inversiones por lote" en docs/DECISIONS.md. */
export function InvestmentLotsDialog({ asset, assets, onOpenChange }: InvestmentLotsDialogProps) {
  const lots = useInvestmentLots(asset?.id)
  const [lotDialogOpen, setLotDialogOpen] = useState(false)
  const [editingLot, setEditingLot] = useState<InvestmentLot | undefined>(undefined)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deleteLinkedTransaction, setDeleteLinkedTransaction] = useState(false)
  const pendingDeleteLot = lots?.find((l) => l.id === pendingDeleteId)

  function openCreateLot() {
    setEditingLot(undefined)
    setLotDialogOpen(true)
  }

  function openEditLot(lot: InvestmentLot) {
    setEditingLot(lot)
    setLotDialogOpen(true)
  }

  function openDeleteDialog(id: string) {
    setDeleteLinkedTransaction(false)
    setPendingDeleteId(id)
  }

  async function handleDelete() {
    if (!pendingDeleteId) return
    try {
      await deleteInvestmentLot(pendingDeleteId, { deleteLinkedTransaction })
      toast.success('Compra eliminada')
    } catch {
      toast.error('No se pudo eliminar')
    } finally {
      setPendingDeleteId(null)
    }
  }

  return (
    <>
      <Dialog open={!!asset} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Compras de {asset?.symbol ?? asset?.name}</DialogTitle>
            <DialogDescription>
              Cada compra que cargaste para esta posición — la cantidad y el costo promedio se recalculan solos.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            {lots === undefined ? (
              <div className="h-24 animate-pulse rounded-xl bg-muted" />
            ) : lots.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Todavía no hay compras cargadas.</p>
            ) : (
              lots.map((lot) => (
                <div key={lot.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{formatQuantity(quantity(lot.quantity))} unidades</p>
                      {lot.transactionId !== undefined && (
                        <Badge variant="secondary" className="shrink-0">
                          Vinculada a un movimiento
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatFullDate(lot.date)}
                      {lot.costPerUnit !== undefined && (
                        <>
                          {' '}
                          · <MoneyText value={money(lot.costPerUnit, lot.currency)} className="inline" /> /unidad
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" aria-label="Editar compra" onClick={() => openEditLot(lot)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Eliminar compra"
                      onClick={() => openDeleteDialog(lot.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={openCreateLot}>
              <Plus className="size-4" />
              Agregar compra
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InvestmentLotFormDialog
        open={lotDialogOpen}
        lot={editingLot}
        assets={assets}
        availableAssets={assets}
        {...(asset && { initialAssetId: asset.id })}
        onOpenChange={setLotDialogOpen}
      />

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta compra?</AlertDialogTitle>
            <AlertDialogDescription>
              La cantidad y el costo promedio de la posición se recalculan sin ella. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDeleteLot?.transactionId !== undefined && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="delete-linked-transaction"
                checked={deleteLinkedTransaction}
                onCheckedChange={(checked) => setDeleteLinkedTransaction(checked === true)}
              />
              <Label htmlFor="delete-linked-transaction" className="text-sm font-normal">
                Borrar también el movimiento vinculado
              </Label>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
