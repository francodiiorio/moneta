import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { movementKindSchema, type MovementKind } from '../schema'
import { useSettings } from '../hooks/useSettings'
import type { TransactionListItem } from '../service'
import { MovementForm } from './MovementForm'

interface TransactionFormDialogProps {
  open: boolean
  item: TransactionListItem | undefined
  onOpenChange: (open: boolean) => void
}

const COPY: Record<MovementKind, { create: string; edit: string; description: string }> = {
  expense: {
    create: 'Nuevo gasto',
    edit: 'Editar gasto',
    description: 'Registrá en qué se fue la plata y, si fue con tarjeta, con cuál.',
  },
  income: {
    create: 'Nuevo ingreso',
    edit: 'Editar ingreso',
    description: 'Registrá plata que te entró: el sueldo, un cobro, una devolución.',
  },
}

/** One dialog for gastos and ingresos — one form (MovementForm), so
 *  switching between them keeps what was typed. Editing never switches
 *  kind: the tabs only show when creating. */
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
  item: TransactionListItem | undefined
  defaultCurrency: string
  onClose: () => void
}

function DialogBody({ item: itemProp, defaultCurrency, onClose }: DialogBodyProps) {
  // Pinned to what was being edited when the dialog opened: closing it
  // clears the page's editing id while Radix still plays the exit
  // animation, and reading the live prop would flash "Nuevo …", the tabs
  // and empty fields during those ~200 ms.
  const [item] = useState(itemProp)
  const [mode, setMode] = useState<MovementKind>(item?.kind ?? 'expense')
  // While editing, the item decides — never a tab picked before.
  const activeMode: MovementKind = item?.kind ?? mode
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
            const parsed = movementKindSchema.safeParse(v)
            if (parsed.success) setMode(parsed.data)
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="expense">Gasto</TabsTrigger>
            <TabsTrigger value="income">Ingreso</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <MovementForm kind={activeMode} defaultCurrency={defaultCurrency} item={item} onSaved={onClose} onCancel={onClose} />
    </>
  )
}
