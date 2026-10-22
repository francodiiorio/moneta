import { useState } from 'react'
import { z } from 'zod'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { movementKindSchema } from '../schema'
import type { EditableTransactionItem } from '../service'
import { MovementForm } from './MovementForm'
import { TransferForm } from './TransferForm'

const dialogModeSchema = z.union([movementKindSchema, z.literal('transfer')])
type DialogMode = z.infer<typeof dialogModeSchema>

interface TransactionFormDialogProps {
  open: boolean
  item: EditableTransactionItem | undefined
  onOpenChange: (open: boolean) => void
}

const COPY: Record<DialogMode, { create: string; edit: string; description: string }> = {
  expense: {
    create: 'Nuevo gasto',
    edit: 'Editar gasto',
    description: 'Registrá en qué se fue la plata. Si lo pagaste con débito, elegí la cuenta.',
  },
  income: {
    create: 'Nuevo ingreso',
    edit: 'Editar ingreso',
    description: 'Registrá plata que entró a una de tus cuentas.',
  },
  transfer: {
    create: 'Nueva transferencia',
    edit: 'Editar transferencia',
    description:
      'Plata que pasa de una cuenta tuya a otra. No es gasto ni ingreso: sólo mueve saldos. Si cambia la moneda, cargá los dos montos reales.',
  },
}

/** One dialog, three kinds of movement. Gasto and ingreso share a form
 *  (MovementForm — switching between them keeps what was typed); a
 *  transferencia has a shape of its own (TransferForm). Editing never
 *  switches kind: the tabs only show when creating. */
export function TransactionFormDialog({ open, item, onOpenChange }: TransactionFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Radix unmounts the content while closed, so the body — and its
            tab state — starts fresh on every open, from the item if any. */}
        <DialogBody item={item} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function DialogBody({ item, onClose }: { item: EditableTransactionItem | undefined; onClose: () => void }) {
  const [mode, setMode] = useState<DialogMode>(item?.kind ?? 'expense')
  // While editing, the item decides — never a tab picked before.
  const activeMode: DialogMode = item?.kind ?? mode
  const copy = COPY[activeMode]

  return (
    <>
      <DialogHeader>
        <DialogTitle>{item ? copy.edit : copy.create}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>

      {!item && (
        <Tabs
          value={activeMode}
          onValueChange={(v) => {
            const parsed = dialogModeSchema.safeParse(v)
            if (parsed.success) setMode(parsed.data)
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="expense">Gasto</TabsTrigger>
            <TabsTrigger value="income">Ingreso</TabsTrigger>
            <TabsTrigger value="transfer">Transferencia</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {activeMode === 'transfer' ? (
        <TransferForm
          item={item?.kind === 'transfer' ? { ...item, kind: 'transfer' } : undefined}
          onSaved={onClose}
          onCancel={onClose}
        />
      ) : (
        <MovementForm
          kind={activeMode}
          item={item && item.kind !== 'transfer' ? { ...item, kind: item.kind } : undefined}
          onSaved={onClose}
          onCancel={onClose}
        />
      )}
    </>
  )
}
