/**
 * Turns the merchant text a bank prints into the name a person would write
 * ("DLO*RAPPI" → "Rappi", "EMOVA SUBTE" → "Subte"), and guesses a category
 * for it. Both are only a starting point: the import shows them and lets
 * the user change any.
 */

// Exact names for what the payment processors' codes leave unreadable.
const ALIASES: [RegExp, string][] = [
  [/^EMOVA SUBTE/, 'Subte'],
  [/^MAC ?DONALDS|^MC ?DONALDS/, 'McDonald’s'],
  [/^SMARTFIT/, 'Smart Fit'],
  [/^MERCADO ?LIBRE/, 'Mercado Libre'],
  [/^CARREFOUR/, 'Carrefour'],
  [/^HAVANNA/, 'Havanna'],
  [/^FARMACITY/, 'Farmacity'],
  [/^LOJAS RENNER/, 'Lojas Renner'],
  [/^EXPRESS PARANA/, 'Express Paraná'],
  [/^NORAUTO/, 'Norauto'],
  [/^GOMERIAS? /, 'Gomería'],
  // Taxes and charges of the statement itself.
  [/^IMPUESTO DE SELLOS/, 'Impuesto de sellos'],
  [/^INTERESES POR ADELANTOS/, 'Intereses por adelantos'],
  [/^INTERESES/, 'Intereses'],
  [/^DB IVA/, 'IVA'],
  [/^IVA RG ?4240/, 'Percepción IVA (RG 4240)'],
  [/^IIBB PERCEP/, 'Percepción IIBB'],
  [/^COMISION CUENTA FULL/, 'Comisión cuenta full'],
  [/^COMISION/, 'Comisión'],
]

// Payment processors print their code before the merchant: "MERPAGO*",
// "DLO*", "PVS*NS-", "PAYU*AR*", "MEP*".
const PROCESSOR_PREFIX = /^(?:[A-Z]{2,8}\*)+(?:NS-)?/

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(' ')
    // Short words ("de", "en") stay lowercase, except the first.
    .map((word, i) => (i > 0 && word.length <= 2 ? word : word.replace(/(^|-)(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())))
    .join(' ')
}

/** The merchant's name as a person would write it. */
export function normalizeMerchant(raw: string): string {
  const text = raw.toUpperCase().replace(/\s+/g, ' ').trim()
  const bare = text.replace(PROCESSOR_PREFIX, '').trim()
  for (const [pattern, name] of ALIASES) {
    if (pattern.test(bare) || pattern.test(text)) return name
  }
  // A branch number ("FARMACITY 28", "EXPRESS PARANA 1053") isn't the name.
  const name = bare.replace(/\s+\d+$/, '').trim()
  // Without its processor code a name can be glued ("SMARTFITSAU"); keep it.
  return titleCase(name || text)
}

// Keywords → one of the default category names (src/database/repositories/
// categories.repo.ts). Only used when the user never categorized that
// merchant before — what they chose last time always wins.
const KEYWORDS: [string, RegExp][] = [
  ['Comida', /rappi|pedidos ?ya|carrefour|coto|jumbo|disco|\bdia\b|mcdonald|burger|havanna|starbucks|caf[eé]|euroma|express|supermercado|panader|restaurant|masok|sushi|pizza/i],
  ['Transporte', /subte|emova|uber|cabify|didi|ypf|shell|axion|nafta|peaje|sube|estacionamiento|norauto|gomer/i],
  ['Salud', /farmac|smart ?fit|gimnasio|gym|osde|galeno|swiss medical|medic|odonto|optica/i],
  ['Entretenimiento', /netflix|spotify|hoyts|cinemark|cine|steam|disney|hbo|max\b|prime video|betwarrior|teatro/i],
  ['Ropa', /renner|zara|vans|nike|adidas|equus|h&m|indumentaria|zapat/i],
  ['Educación', /libreria|librer[ií]a|curso|udemy|coursera|universidad|colegio/i],
  ['Vivienda', /expensas|alquiler|edenor|edesur|metrogas|aysa|personal|movistar|claro|telecentro|fibertel/i],
]

/** The default category name a merchant most likely belongs to, or
 *  `undefined` when nothing matches. */
export function guessCategoryName(merchant: string): string | undefined {
  return KEYWORDS.find(([, pattern]) => pattern.test(merchant))?.[0]
}
