import { formatMoney, parseAmount, type CurrencyCode } from '@/domain/money'

interface ParsedAmountHintProps {
  /** The raw text in the amount input. */
  value: string
  currency: CurrencyCode | undefined
}

/** Shows how a typed amount will be read before it's saved — "1.085"
 *  is es-AR thousands (1085), not 1,085 (see ADR "Montos: el punto es
 *  separador de miles"). For fields where a misread is plausible and
 *  costly, like an asset price: off by ×1000 silently inflates the whole
 *  position. Renders nothing while the input isn't a readable number. */
export function ParsedAmountHint({ value, currency }: ParsedAmountHintProps) {
  if (!currency || !/\d/.test(value)) return null
  let shown: string
  try {
    shown = formatMoney(parseAmount(value, currency))
  } catch {
    return null
  }
  return <p className="text-xs text-muted-foreground">Se guarda como {shown}</p>
}
