import { CATEGORY_ICON_BY_KEY, DEFAULT_CATEGORY_ICON } from './categoryOptions'
import { cn } from '@/lib/cn'

const SIZES = {
  sm: { box: 'size-6', icon: 'size-3.5' },
  md: { box: 'size-9', icon: 'size-4.5' },
} as const

/** Every CATEGORY_COLOR_OPTIONS entry matches this, but `Category.color`
 *  itself is an unvalidated `z.string().optional()` (see
 *  domain/entities/schemas.ts) — a value from an older export, a
 *  hand-edited backup, or a future picker revision could be anything.
 *  Appending an alpha suffix to something that isn't a clean 6-digit hex
 *  would silently produce an invalid CSS color (the browser just drops
 *  the whole `background-color` declaration) — checked once here instead
 *  of trusting every caller's data. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i

interface CategoryIconProps {
  icon?: string | undefined
  color?: string | undefined
  size?: keyof typeof SIZES
  className?: string
}

/** Small round badge for a category's chosen icon/color — falls back to a
 *  neutral tag icon on muted background when neither is set, so every
 *  category (customized or not) renders consistently wherever this is
 *  used (listas de categorías, el picker, movimientos, presupuestos). */
export function CategoryIcon({ icon, color, size = 'md', className }: CategoryIconProps) {
  const Icon = (icon ? CATEGORY_ICON_BY_KEY[icon] : undefined) ?? DEFAULT_CATEGORY_ICON
  const { box, icon: iconSize } = SIZES[size]
  const validColor = color && HEX_COLOR.test(color) ? color : undefined

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        box,
        !validColor && 'bg-muted text-muted-foreground',
        className,
      )}
      // Arbitrary user-chosen hex can't be a Tailwind class (not known at
      // build time) — inline style is the only reliable way to apply it.
      style={validColor ? { backgroundColor: `${validColor}1a`, color: validColor } : undefined}
    >
      <Icon className={iconSize} />
    </div>
  )
}
