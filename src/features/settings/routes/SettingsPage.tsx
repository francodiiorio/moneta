import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BackupCard } from '@/features/backups/components/BackupCard'
import { useSettings } from '../hooks/useSettings'
import { settingsRepo } from '@/database/repositories'
import { CURRENCIES } from '@/domain/money'

const CURRENCY_OPTIONS = Object.keys(CURRENCIES)

export function SettingsPage() {
  const settings = useSettings()
  const { theme, setTheme } = useTheme()

  // next-themes only knows the real theme after mount (it reads
  // localStorage client-side) — render a placeholder until then instead
  // of feeding an undefined value into the controlled Select.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // Standard next-themes pattern: theme is only known client-side after mount.
    setMounted(true) // eslint-disable-line react-hooks/set-state-in-effect
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Ajustes" description="Preferencias y backup de tus datos." />

      <Card>
        <CardHeader>
          <CardTitle>Preferencias</CardTitle>
          <CardDescription>Moneda base para totales consolidados y tema visual.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Moneda base</Label>
            {settings ? (
              <Select
                value={settings.baseCurrency}
                onValueChange={(value) => void settingsRepo.updateSettings({ baseCurrency: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="h-9 animate-pulse rounded-md bg-muted" />
            )}
          </div>

          <div className="grid gap-2">
            <Label>Tema</Label>
            {mounted && theme ? (
              <Select value={theme} onValueChange={setTheme}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">Sistema</SelectItem>
                  <SelectItem value="light">Claro</SelectItem>
                  <SelectItem value="dark">Oscuro</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="h-9 animate-pulse rounded-md bg-muted" />
            )}
          </div>
        </CardContent>
      </Card>

      <BackupCard />
    </div>
  )
}
