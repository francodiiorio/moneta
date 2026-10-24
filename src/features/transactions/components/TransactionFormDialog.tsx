import { useState } from 'react'
import { z } from 'zod'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { movementKindSchema } from '../schema'
import { useSettings } from '../hooks/useSettings'
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
    description: 'Registrá en qué se fue la plata y con qué la pagaste: débito de una cuenta o tarjeta de crédito.',
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
  const settings = useSettings()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Radix unmounts the content while closed, so the body — and its
            tab state — starts fresh on every open, from the item if any.
            Waits for settings: the forms read their default currency once,
            when they mount, so mounting them before settings load would
            silently default every new gasto to ARS. */}
        {settings && (
          <DialogBody
            item={item}
            defaultCurrency={settings.baseCurrency}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

interface DialogBodyProps {
  item: EditableTransactionItem | undefined
  defaultCurrency: string
  onClose: () => void
}

function DialogBody({ item: itemProp, defaultCurrency, onClose }: DialogBodyProps) {
  // Pinned to what was being edited when the dialog opened: closing it
  // clears the page's editing id while Radix still plays the exit
  // animation, and reading the live prop would flash "Nuevo …", the tabs
  // and empty fields during those ~200 ms.
  const [item] = useState(itemProp)
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
          defaultCurrency={defaultCurrency}
          item={item && item.kind !== 'transfer' ? { ...item, kind: item.kind } : undefined}
          onSaved={onClose}
          onCancel={onClose}
        />
      )}
    </>
  )
}
