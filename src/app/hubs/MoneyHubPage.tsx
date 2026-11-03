import { CardsPage } from '@/features/cards/routes/CardsPage'
import { PlansPage } from '@/features/plans/routes/PlansPage'
import { HubPage } from './HubPage'

export function MoneyHubPage() {
  return (
    <HubPage
      title="Tarjetas"
      tabs={[
        { value: 'tarjetas', label: 'Tarjetas', content: <CardsPage embedded /> },
        { value: 'cuotas', label: 'Cuotas', content: <PlansPage kind="installments" /> },
      ]}
    />
  )
}
