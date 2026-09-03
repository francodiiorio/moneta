import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  PiggyBank,
  CalendarSync,
  BarChart3,
  Landmark,
  Settings,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/cuentas', label: 'Cuentas', icon: Wallet },
  { to: '/movimientos', label: 'Movimientos', icon: ArrowLeftRight },
  { to: '/presupuestos', label: 'Presupuestos', icon: PiggyBank },
  { to: '/planes', label: 'Planes', icon: CalendarSync },
  { to: '/patrimonio', label: 'Ahorro e Inversiones', icon: Landmark },
  { to: '/reportes', label: 'Reportes', icon: BarChart3 },
  { to: '/ajustes', label: 'Ajustes', icon: Settings },
]
