import {
  Baby,
  Briefcase,
  Car,
  Coffee,
  Dumbbell,
  Film,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Landmark,
  Music,
  PawPrint,
  Phone,
  PiggyBank,
  Plane,
  Receipt,
  Shirt,
  ShoppingBag,
  Sparkles,
  Tag,
  TrendingUp,
  Utensils,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/** Curated set — not every Lucide icon, just the ones that read clearly at
 *  badge size for a personal-finance category. `key` is what's stored on
 *  `Category.icon`; label is only for the picker's title/tooltip. */
export const CATEGORY_ICON_OPTIONS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'utensils', label: 'Comida', icon: Utensils },
  { key: 'car', label: 'Transporte', icon: Car },
  { key: 'home', label: 'Vivienda', icon: Home },
  { key: 'heart-pulse', label: 'Salud', icon: HeartPulse },
  { key: 'shopping-bag', label: 'Compras', icon: ShoppingBag },
  { key: 'shirt', label: 'Ropa', icon: Shirt },
  { key: 'graduation-cap', label: 'Educación', icon: GraduationCap },
  { key: 'plane', label: 'Viajes', icon: Plane },
  { key: 'gamepad-2', label: 'Entretenimiento', icon: Gamepad2 },
  { key: 'film', label: 'Cine / streaming', icon: Film },
  { key: 'music', label: 'Música', icon: Music },
  { key: 'coffee', label: 'Salidas', icon: Coffee },
  { key: 'dumbbell', label: 'Deporte', icon: Dumbbell },
  { key: 'paw-print', label: 'Mascotas', icon: PawPrint },
  { key: 'baby', label: 'Hijos', icon: Baby },
  { key: 'gift', label: 'Regalos', icon: Gift },
  { key: 'wifi', label: 'Servicios', icon: Wifi },
  { key: 'zap', label: 'Energía', icon: Zap },
  { key: 'phone', label: 'Teléfono', icon: Phone },
  { key: 'wrench', label: 'Mantenimiento', icon: Wrench },
  { key: 'sparkles', label: 'Cuidado personal', icon: Sparkles },
  { key: 'briefcase', label: 'Trabajo', icon: Briefcase },
  { key: 'landmark', label: 'Impuestos / banco', icon: Landmark },
  { key: 'piggy-bank', label: 'Ahorro', icon: PiggyBank },
  { key: 'trending-up', label: 'Inversión', icon: TrendingUp },
  { key: 'receipt', label: 'Facturas', icon: Receipt },
]

/** Plain object, not a Map — a direct property lookup, same shape as
 *  RECURRING_KIND_ICONS/TRANSACTION_KIND_ICONS elsewhere in the repo, so
 *  resolving an icon for JSX is a single indexing expression the React
 *  Compiler can analyze (a `.get()` call tripped its "cannot create
 *  components during render" check). */
export const CATEGORY_ICON_BY_KEY: Record<string, LucideIcon | undefined> = Object.fromEntries(
  CATEGORY_ICON_OPTIONS.map((o) => [o.key, o.icon]),
)

/** Fallback for a category with no icon set (or an unrecognized/stale key
 *  — e.g. from an older CATEGORY_ICON_OPTIONS revision in an imported
 *  backup). */
export const DEFAULT_CATEGORY_ICON: LucideIcon = Tag

/** Curated categorical hues — a fixed order, not generated, so two
 *  categories never get a color by accident and every user sees the same
 *  palette. `value` is standalone hex (not a CSS token): stored verbatim
 *  on `Category.color` and exported/imported with the backup like any
 *  other user data, so it must mean the same thing regardless of theme.
 *  `label` is only for the picker's accessible name — never persisted. */
export const CATEGORY_COLOR_OPTIONS: { value: string; label: string }[] = [
  { value: '#ef4444', label: 'Rojo' },
  { value: '#f97316', label: 'Naranja' },
  { value: '#f59e0b', label: 'Ámbar' },
  { value: '#eab308', label: 'Amarillo' },
  { value: '#84cc16', label: 'Lima' },
  { value: '#22c55e', label: 'Verde' },
  { value: '#14b8a6', label: 'Verde azulado' },
  { value: '#06b6d4', label: 'Cian' },
  { value: '#3b82f6', label: 'Azul' },
  { value: '#6366f1', label: 'Índigo' },
  { value: '#8b5cf6', label: 'Violeta' },
  { value: '#ec4899', label: 'Rosa' },
]
