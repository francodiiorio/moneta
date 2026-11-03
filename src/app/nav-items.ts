import {
  LayoutDashboard,
  ArrowLeftRight,
  PiggyBank,
  BarChart3,
  Landmark,
  CreditCard,
  Settings,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

/** The five sections — the same in the sidebar and the mobile bottom nav. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Inicio', icon: LayoutDashboard },
  { to: '/movimientos', label: 'Movimientos', icon: ArrowLeftRight },
  { to: '/tarjetas', label: 'Tarjetas', icon: CreditCard },
  { to: '/presupuestos', label: 'Presupuesto', icon: PiggyBank },
  { to: '/patrimonio', label: 'Patrimonio', icon: Landmark },
]

/** Out of the main nav: at the bottom of the sidebar, and as icons in the
 *  mobile top bar. */
export const SECONDARY_NAV_ITEMS: NavItem[] = [
  { to: '/reportes', label: 'Reportes', icon: BarChart3 },
  { to: '/ajustes', label: 'Ajustes', icon: Settings },
]
