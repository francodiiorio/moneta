import { applyRate, magnitude, percentChange, sub, sumMoney, type CurrencyCode, type Money } from '@/domain/money'
import type { DateStamp } from '@/lib/dates'

/** One gasto to compare, already in the comparison's currency. */
export interface SpendingEntry {
  period: 'current' | 'previous'
  date: DateStamp
  /** What the user wrote: the merchant. */
  description: string
  /** Missing for a category that no longer exists — the gasto still counts
   *  for its merchant and the total. */
  category?: { id: string; name: string }
  /** Undefined when there's no rate to convert it: its merchant and
   *  category can't be compared — a side without it reads as a fake
   *  "+120%". */
  amount: Money | undefined
}

/** What one merchant or category cost in two comparable periods, both in
 *  the same currency. */
export interface SpendingPair {
  kind: 'merchant' | 'category'
  key: string
  label: string
  current: Money
  previous: Money
  /** A category whose gastos, in both periods, are all one merchant: that
   *  merchant's key — saying both would say the same thing twice. */
  soleMerchant?: string
  /** Some gasto of it couldn't be converted: not comparable. */
  partial?: true
}

export interface SpendingObservation extends SpendingPair {
  /** Against the previous period: 40 is 40% more, −25 is 25% less. */
  percent: number
}

/** "Café  Martínez" and "cafe martinez" are one merchant. */
const merchantKey = (description: string) =>
  description
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/**
 * Totals by merchant (the description, case, accents and spaces aside,
 * named as it was written last) and by category, for each period; and what
 * the previous period added up to (what could be converted).
 */
export function groupSpending(entries: readonly SpendingEntry[], currency: CurrencyCode): { pairs: SpendingPair[]; previousTotal: Money } {
  type Group = {
    kind: SpendingPair['kind']
    label: string
    labelDate: DateStamp
    current: Money[]
    previous: Money[]
    merchants: Set<string>
    partial: boolean
  }
  const groups = new Map<string, Group>()
  function addTo(kind: Group['kind'], key: string, label: string, entry: SpendingEntry, merchant: string) {
    const id = `${kind}:${key}`
    const group = groups.get(id) ?? { kind, label, labelDate: entry.date, current: [], previous: [], merchants: new Set<string>(), partial: false }
    if (entry.date > group.labelDate) Object.assign(group, { label, labelDate: entry.date })
    if (entry.amount) group[entry.period].push(entry.amount)
    else group.partial = true
    group.merchants.add(merchant)
    groups.set(id, group)
  }

  for (const entry of entries) {
    const key = merchantKey(entry.description)
    if (key === '') continue
    addTo('merchant', key, entry.description.trim().replace(/\s+/g, ' '), entry, key)
    if (entry.category) addTo('category', entry.category.id, entry.category.name, entry, key)
  }

  const pairs = [...groups.entries()].map(([id, g]): SpendingPair => {
    const [only, ...others] = g.merchants
    return {
      kind: g.kind,
      key: id,
      label: g.label,
      current: sumMoney(currency, g.current),
      previous: sumMoney(currency, g.previous),
      ...(g.kind === 'category' && only !== undefined && others.length === 0 && { soleMerchant: `merchant:${only}` }),
      ...(g.partial && { partial: true as const }),
    }
  })
  const previousTotal = sumMoney(
    currency,
    entries.flatMap((e) => (e.period === 'previous' && e.amount ? [e.amount] : [])),
  )
  return { pairs, previousTotal }
}

/** A smaller change, in percent, is ordinary month-to-month noise… */
export const MIN_CHANGE_PERCENT = 25
/** …and so is one smaller than this share of everything spent in the
 *  previous period — a $ 2.000 kiosk that doubled isn't news. */
export const MIN_SHARE_OF_TOTAL = 0.05

/**
 * The few changes worth saying out loud ("Rappi: 40% más que en
 * octubre"): spent in both periods, by a lot in percent and in money,
 * largest change in money first. A category that is a single merchant
 * would say the same thing twice — the merchant, more specific, stays.
 */
export function spendingObservations(pairs: readonly SpendingPair[], previousTotal: Money, limit = 3): SpendingObservation[] {
  if (previousTotal.amount <= 0) return []
  const minDifference = applyRate(previousTotal.amount, MIN_SHARE_OF_TOTAL)
  const candidates = pairs.flatMap((pair) => {
    if (pair.partial || pair.current.amount <= 0 || pair.previous.amount <= 0) return []
    const percent = percentChange(pair.previous, pair.current)
    if (percent === undefined || Math.abs(percent) < MIN_CHANGE_PERCENT) return []
    const difference = magnitude(sub(pair.current, pair.previous))
    if (difference.amount < minDifference) return []
    return [{ observation: { ...pair, percent }, difference: difference.amount }]
  })
  candidates.sort(
    (a, b) =>
      b.difference - a.difference ||
      (a.observation.kind === b.observation.kind ? 0 : a.observation.kind === 'merchant' ? -1 : 1) ||
      a.observation.label.localeCompare(b.observation.label, 'es'),
  )

  const chosen: SpendingObservation[] = []
  for (const { observation } of candidates) {
    if (chosen.length === limit) break
    const repeats = chosen.some(
      (c) =>
        (observation.soleMerchant !== undefined && observation.soleMerchant === c.key) ||
        (c.soleMerchant !== undefined && c.soleMerchant === observation.key),
    )
    if (!repeats) chosen.push(observation)
  }
  return chosen
}
