import { Settings, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { InvestmentAsset } from '@/domain/entities'
import { INVESTMENT_ASSET_TYPE_LABELS } from '../labels'

interface InvestmentAssetRowProps {
  asset: InvestmentAsset
  onAddHolding: () => void
  onEditAsset: () => void
  onDelete: () => void
}

/** An asset that exists but has no position yet — without this row it
 *  creating an asset looked like it silently did nothing, since the
 *  Inversiones list otherwise only renders holdings (see the "cree una
 *  inversion... pero no me aparece" confusion this fixes). Dashed border
 *  tells it apart from a funded InvestmentRow at a glance. */
export function InvestmentAssetRow({ asset, onAddHolding, onEditAsset, onDelete }: InvestmentAssetRowProps) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-border p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{asset.symbol ?? asset.name}</p>
          <Badge variant="secondary">{INVESTMENT_ASSET_TYPE_LABELS[asset.type]}</Badge>
        </div>
        {asset.symbol && <p className="truncate text-xs text-muted-foreground">{asset.name}</p>}
        <p className="mt-1 text-xs text-muted-foreground">Sin posición cargada</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="outline" size="sm" onClick={onAddHolding}>
          Agregar posición
        </Button>
        <Button variant="ghost" size="icon" aria-label="Configurar activo" onClick={onEditAsset}>
          <Settings className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Eliminar activo" onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
