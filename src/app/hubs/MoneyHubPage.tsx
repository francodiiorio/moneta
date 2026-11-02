import { CardsPage } from '@/features/cards/routes/CardsPage'
import { AccountsPage } from '@/features/accounts/routes/AccountsPage'
import { PlansPage } from '@/features/plans/routes/PlansPage'
import { HubPage } from './HubPage'

export function MoneyHubPage() {
  return (
    <HubPage
      title="Tarjetas y cuentas"
      tabs={[
        { value: 'tarjetas', label: 'Tarjetas', content: <CardsPage embedded /> },
        { value: 'cuentas', label: 'Cuentas', content: <AccountsPage embedded /> },
        { value: 'cuotas', label: 'Cuotas', content: <PlansPage kind="installments" /> },
      ]}
    />
  )
}
