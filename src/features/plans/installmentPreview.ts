import { allocate, formatMoney, money, parseAmount, type CurrencyCode } from '@/domain/money'

// Reasonable upper bound for a live preview while typing — well beyond
// any real cuotas plan (30 years of monthly), just guards against
// building a huge allocate() array from a stray keystroke.
export const MAX_PREVIEW_COUNT = 360

/** `allocate()`'s largest-remainder split can differ by a cent across
 *  installments (e.g. $100 / 3 = $33,33 + $33,33 + $33,34) — never
 *  divides evenly and rounds each part on its own, per CLAUDE.md
 *  "Reparto de cuotas". Returns undefined while the fields don't yet
 *  add up to a previewable plan (still typing, no account chosen, etc.). */
export function getInstallmentPreview(
  totalAmountInput: string,
  countInput: string,
  currency: CurrencyCode | undefined,
): string | undefined {
  if (!currency || !/\d/.test(totalAmountInput)) return undefined

  const count = Number(countInput)
  if (!Number.isInteger(count) || count <= 0 || count > MAX_PREVIEW_COUNT) return undefined

  let total
  try {
    total = parseAmount(totalAmountInput, currency)
  } catch {
    return undefined // invalid/partial input mid-typing — no preview yet
  }
  if (total.amount <= 0) return undefined

  const shares = allocate(total.amount, Array<number>(count).fill(1))
  const min = Math.min(...shares)
  const max = Math.max(...shares)

  return min === max
    ? `= ${formatMoney(money(min, currency))} por cuota`
    : `= ${formatMoney(money(min, currency))}–${formatMoney(money(max, currency))} por cuota`
}
