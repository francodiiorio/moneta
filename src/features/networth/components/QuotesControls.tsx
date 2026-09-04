import { useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { settingsRepo } from '@/database/repositories'
import type { Settings } from '@/domain/entities'
import { formatRelativeTime } from '@/lib/dates'
import { RATE_PROFILE_LABELS } from '../labels'
import { refreshQuotes } from '../service'

interface QuotesControlsProps {
  settings: Settings
}

export function QuotesControls({ settings }: QuotesControlsProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)

  async function handleToggleAuto(checked: boolean) {
    try {
      await settingsRepo.updateSettings({ autoQuotesEnabled: checked })
    } catch {
      toast.error('No se pudo cambiar la actualización automática')
    }
  }

  async function handleProfileChange(profile: string) {
    try {
      await settingsRepo.updateSettings({ rateProfile: profile })
    } catch {
      toast.error('No se pudo cambiar la referencia')
    }
  }

  async function handleRefreshNow() {
    setIsRefreshing(true)
    try {
      const { ratesAdded, pricesAdded, failed } = await refreshQuotes()
      const parts: string[] = []
      if (ratesAdded > 0) parts.push(`${ratesAdded} tasa${ratesAdded === 1 ? '' : 's'}`)
      if (pricesAdded > 0) parts.push(`${pricesAdded} precio${pricesAdded === 1 ? '' : 's'}`)
      if (parts.length > 0) toast.success(`Actualizado: ${parts.join(' y ')}`)
      else toast.info('No había nada nuevo para traer')
      if (failed.length > 0) {
        toast.warning(`No se pudo consultar: ${failed.join(', ')} — se mantiene la última cotización válida`)
      }
    } catch {
      toast.error('No se pudo actualizar')
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actualización automática</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="auto-quotes">Traer cotizaciones solas al abrir la app</Label>
            <p className="text-xs text-muted-foreground">
              Dólar (oficial, blue, MEP, CCL, mayorista, cripto, tarjeta), EUR/USD, y el precio de cripto y
              CEDEARs para los activos con "Actualizar precio automáticamente" activado. Nunca envía datos de
              tus cuentas ni movimientos — sólo los pares de moneda o símbolos que necesita.
            </p>
          </div>
          <Switch id="auto-quotes" checked={!!settings.autoQuotesEnabled} onCheckedChange={(c) => void handleToggleAuto(c)} />
        </div>

        <div className="flex flex-col gap-1.5 sm:w-64">
          <Label>Cotización USD para valuar tu patrimonio</Label>
          <Select value={settings.rateProfile ?? 'oficial'} onValueChange={(v) => void handleProfileChange(v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(RATE_PROFILE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {settings.quotesRefreshedAt
              ? `Última actualización automática: ${formatRelativeTime(settings.quotesRefreshedAt)}`
              : 'Todavía no se actualizó automáticamente'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void handleRefreshNow()} disabled={isRefreshing}>
            <RefreshCw className="size-3.5" />
            Actualizar ahora
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
