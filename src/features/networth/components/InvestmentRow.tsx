import { Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { MoneyText } from '@/components/MoneyText'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatQuantity, quantity } from '@/domain/decimal'
import { isNegative, isPositive, money, roundHalfUp } from '@/domain/money'
import { cn } from '@/lib/cn'
import { INVESTMENT_ASSET_TYPE_LABELS } from '../labels'
import type { InvestmentHoldingWithDetails } from '../service'

interface InvestmentRowProps {
  item: InvestmentHoldingWithDetails
  /** Opens InvestmentLotsDialog — a posición ya no se edita directo,
   *  se administra como la suma de sus compras. */
  onManageLots: () => void
  onDelete: () => void
  onLoadPrice: () => void
}

export function InvestmentRow({ item, onManageLots, onDelete, onLoadPrice }: InvestmentRowProps) {
  const { holding, asset, price, nativeValue, convertedValue, gainLoss, gainLossPercent } = item
  const isGain = gainLoss !== undefined && isPositive(gainLoss)
  const isLoss = gainLoss !== undefined && isNegative(gainLoss)
  const gainSign = isGain ? '+' : ''

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{asset.symbol ?? asset.name}</p>
            <Badge variant="secondary">{INVESTMENT_ASSET_TYPE_LABELS[asset.type]}</Badge>
          </div>
          {asset.symbol && <p className="truncate text-xs text-muted-foreground">{asset.name}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onLoadPrice} title="Cargar precio">
            <RefreshCw className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onManageLots} title="Compras">
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {formatQuantity(quantity(holding.quantity))} unidades
          {price && (
            <>
              {' '}
              · <MoneyText value={money(price.price, price.currency)} className="inline" /> / unidad
            </>
          )}
        </span>
        <div className="text-right">
          {nativeValue ? (
            <p className="font-medium">
              <MoneyText value={nativeValue} />
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Sin precio cargado</p>
          )}
          {convertedValue && convertedValue.currency !== nativeValue?.currency && (
            <p className="text-xs text-muted-foreground">
              ≈ <MoneyText value={convertedValue} className="inline" />
            </p>
          )}
          {gainLoss && (
            <p className={cn('text-xs font-medium', isGain && 'text-positive', isLoss && 'text-negative')}>
              {gainSign}
              <MoneyText value={gainLoss} className="inline" />
              {gainLossPercent !== undefined && ` (${gainSign}${roundHalfUp(gainLossPercent)}%)`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
