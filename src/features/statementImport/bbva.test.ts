import { describe, expect, it } from 'vitest'
import { groupTokensIntoLines, parseBbvaStatement, parseStatementAmount, parseStatementDate, StatementParseError, unreadAmount, type StatementLine } from './bbva'

// A made-up statement laid out like a real BBVA one (same columns and
// sections, invented merchants and amounts).
const t = (x: number, text: string) => ({ x, text })
const COLUMNS: StatementLine = [t(62, 'FECHA'), t(114, 'DESCRIPCIÓN'), t(380, 'NRO. CUPÓN'), t(476, 'PESOS'), t(536, 'DÓLARES')]
const STATEMENT: StatementLine[] = [
  [t(62, 'Visa Gold'), t(115, 'cuenta 1111111111'), t(486, 'CONSOLIDADO')],
  [t(88, 'CIERRE ACTUAL'), t(180, 'VENCIMIENTO ACTUAL'), t(298, 'SALDO ACTUAL $'), t(395, 'SALDO ACTUAL U$S'), t(502, 'PAGO MÍNIMO $')],
  [t(88, '22-Oct-26'), t(180, '04-Nov-26'), t(298, '80.120,00'), t(395, '0,00'), t(502, '30.000,00')],
  [t(458, 'Pesos'), t(533, 'Dólares')],
  [t(62, 'SALDO ANTERIOR'), t(437, '80.000,00'), t(556, '0,00')],
  [t(171, 'CIERRE ANTERIOR'), t(267, 'VENCIMIENTO ANTERIOR'), t(387, 'PRÓXIMO CIERRE'), t(486, 'PRÓXIMO VENCIMIENTO')],
  [t(62, 'Otros períodos')],
  [t(171, '24-Sep-26'), t(267, '05-Oct-26'), t(387, '19-Nov-26'), t(486, '03-Dic-26')],
  [t(521, 'DETALLE')],
  [t(63, 'Sus pagos y ajustes realizados')],
  COLUMNS,
  [t(62, '05-Oct-26'), t(114, 'SU PAGO EN PESOS'), t(446, '-80.000,00')],
  [t(56, 'Ëhig'), t(62, '05-Oct-26'), t(114, 'STREAMING.COM'), t(554, '-5,90')],
  [t(62, '05-Oct-26'), t(114, '(CREDITO PROV. CONSUMO CUEST.- TJ. 1234 )')],
  [t(63, 'Consumos Franco Ejemplo')],
  COLUMNS,
  [t(62, '06-Abr-26'), t(114, 'MERPAGO*TIENDA'), t(238, 'C.07/12'), t(400, '373239'), t(462, '10.000,00')],
  [t(62, '26-Sep-26'), t(114, 'MERPAGO*APUESTAS'), t(232, '(ADEL.)'), t(400, '349713'), t(457, '50.000,00')],
  // A page break split this row: its date sits with the bank's footer.
  [t(62, '08-Ago-26'), t(585, 'Banco BBVA Argentina S.A.')],
  [t(114, 'FLORES'), t(192, 'C.03/03'), t(400, '001564'), t(462, '20.000,00')],
  [t(62, '05-Oct-26'), t(114, 'STREAMING.COM'), t(201, 'USD'), t(235, '5,90'), t(400, '008701'), t(557, '5,90')],
  [t(114, 'TOTAL CONSUMOS DE FRANCO EJEMPLO'), t(457, '80.000,00'), t(557, '5,90')],
  [t(63, 'Impuestos, cargos e intereses')],
  [t(62, 'FECHA'), t(114, 'DESCRIPCIÓN'), t(476, 'PESOS'), t(536, 'DÓLARES')],
  [t(62, '22-Oct-26'), t(114, 'DB IVA $ 21%'), t(228, '57.200,00'), t(462, '120,00')],
  [t(114, 'SALDO ACTUAL'), t(439, '80.120,00'), t(553, '0,00')],
  [t(62, 'Legales y avisos')],
  [t(62, '22-Oct-26'), t(114, 'NO ES UN MOVIMIENTO'), t(462, '1,00')],
]

describe('parseStatementDate / parseStatementAmount', () => {
  it('reads the bank’s Spanish dates', () => {
    expect(parseStatementDate('06-Abr-26')).toBe('2026-04-06')
    expect(parseStatementDate('03-Dic-26')).toBe('2026-12-03')
    expect(parseStatementDate('08-Ago-26')).toBe('2026-08-08')
    expect(parseStatementDate('31-Feb-26')).toBeUndefined()
    expect(parseStatementDate('06-Xyz-26')).toBeUndefined()
  })

  it('reads amounts into minor units, signed, without floats', () => {
    expect(parseStatementAmount('1.003.759,57')).toBe(100_375_957)
    expect(parseStatementAmount('-180,06')).toBe(-18_006)
    expect(parseStatementAmount('0,00')).toBe(0)
    expect(parseStatementAmount('1003759,57')).toBe(100_375_957)
    expect(parseStatementAmount('9003,40)')).toBeUndefined()
    expect(parseStatementAmount('$')).toBeUndefined()
  })
})

describe('parseBbvaStatement', () => {
  const parsed = parseBbvaStatement(STATEMENT)

  it('reads the summary: product, account, dates, balances', () => {
    expect(parsed).toMatchObject({
      product: 'Visa Gold',
      account: '1111111111',
      closeDate: '2026-10-22',
      dueDate: '2026-11-04',
      nextCloseDate: '2026-11-19',
      nextDueDate: '2026-12-03',
      balance: { ARS: 80_120_00, USD: 0 },
      previousBalance: { ARS: 80_000_00, USD: 0 },
    })
  })

  it('reads every line of the detail, by section, with its cuota and currency', () => {
    expect(parsed.items.map((i) => [i.section, i.date, i.description, i.currency, i.amount])).toEqual([
      ['payments', '2026-10-05', 'SU PAGO EN PESOS', 'ARS', -80_000_00],
      ['payments', '2026-10-05', 'STREAMING.COM', 'USD', -5_90],
      ['purchases', '2026-04-06', 'MERPAGO*TIENDA', 'ARS', 10_000_00],
      ['purchases', '2026-09-26', 'MERPAGO*APUESTAS', 'ARS', 50_000_00],
      ['purchases', '2026-08-08', 'FLORES', 'ARS', 20_000_00],
      ['purchases', '2026-10-05', 'STREAMING.COM', 'USD', 5_90],
      ['charges', '2026-10-22', 'DB IVA $ 21% 57.200,00', 'ARS', 120_00],
    ])
    expect(parsed.items[2]).toMatchObject({ installment: { number: 7, count: 12 }, coupon: '373239', cashAdvance: false })
    expect(parsed.items[3]).toMatchObject({ cashAdvance: true })
    expect(parsed.items[4]).toMatchObject({ installment: { number: 3, count: 3 } })
  })

  it('adds up: previous balance + every line = current balance', () => {
    for (const currency of ['ARS', 'USD'] as const) {
      const lines = parsed.items.filter((i) => i.currency === currency).reduce((sum, i) => sum + i.amount, 0)
      expect(parsed.previousBalance[currency] + lines).toBe(parsed.balance[currency])
    }
  })

  it('a page footer between a split row’s date and the rest doesn’t lose the row', () => {
    const split = STATEMENT.flatMap((line) =>
      line[0]?.text === '08-Ago-26' ? [line, [t(439, 'Sobre (1) 1 de 1 / Página'), t(551, '1 de'), t(569, '3')]] : [line],
    )
    expect(parseBbvaStatement(split).items.some((i) => i.description === 'FLORES')).toBe(true)
  })

  it('with widths, the currency comes from the amount’s right edge — a long dollar amount stays in dollars', () => {
    const w = (x: number, width: number, text: string) => ({ x, width, text })
    const lines: StatementLine[] = [
      ...STATEMENT.slice(0, 15),
      [w(62, 30, 'FECHA'), w(114, 50, 'DESCRIPCIÓN'), w(380, 40, 'NRO. CUPÓN'), w(476, 27, 'PESOS'), w(536, 35, 'DÓLARES')],
      // Starts left of the midpoint between the headers, ends under DÓLARES.
      [w(62, 30, '05-Oct-26'), w(114, 40, 'HOTEL'), w(400, 25, '000001'), w(500, 71, '12.345.678,90')],
    ]
    expect(parseBbvaStatement(lines).items.at(-1)).toMatchObject({ currency: 'USD', amount: 1_234_567_890 })
  })

  it('unreadAmount: what the read lines don’t account for against the printed balance', () => {
    expect(unreadAmount(parsed)).toEqual({ ARS: 0, USD: 0 })
    expect(unreadAmount({ ...parsed, items: parsed.items.slice(1) })).toEqual({ ARS: -80_000_00, USD: 0 })
  })

  it('rejects something that isn’t a BBVA statement', () => {
    expect(() => parseBbvaStatement([[t(62, 'Hola')]])).toThrow(StatementParseError)
  })
})

describe('groupTokensIntoLines', () => {
  it('chains a row whose amount sits a little lower than its date, apart from a footer above; pages in order', () => {
    const lines = groupTokensIntoLines([
      [
        { x: 585, y: 40.25, text: 'Footer' },
        { x: 62, y: 37.51, text: '08-Ago-26' },
        { x: 462, y: 36.86, text: '19.933,33' },
        { x: 114, y: 37.28, text: 'FLORES ' },
        { x: 62, y: 20, text: 'Página 1' },
      ],
      [{ x: 62, y: 700, text: 'Página 2' }],
    ])
    expect(lines.map((l) => l.map((tk) => tk.text))).toEqual([
      ['Footer'],
      ['08-Ago-26', 'FLORES', '19.933,33'],
      ['Página 1'],
      ['Página 2'],
    ])
  })

  it('normalizes decomposed accents', () => {
    const [line] = groupTokensIntoLines([[{ x: 1, y: 1, text: 'PRÓXIMO' }]])
    expect(line?.[0]?.text).toBe('PRÓXIMO')
  })
})
