import { describe, expect, it } from 'vitest'
import { guessCategoryName, normalizeMerchant } from './merchants'

describe('normalizeMerchant', () => {
  it.each([
    ['DLO*RAPPI', 'Rappi'],
    ['MERPAGO*MERCADOLIBRE', 'Mercado Libre'],
    ['PAYU*AR*UBER', 'Uber'],
    ['PVS*NS-EUROMA COCI', 'Euroma Coci'],
    ['MEP*CRUZA POLO', 'Cruza Polo'],
    ['EMOVA SUBTE', 'Subte'],
    ['MAC DONALDS', 'McDonald’s'],
    ['FARMACITY 28', 'Farmacity'],
    ['Express Parana 1053', 'Express Paraná'],
    ['MERPAGO*SMARTFITSAU', 'Smart Fit'],
    ['LOJAS RENNER SANTA FE', 'Lojas Renner'],
    ['IMPUESTO DE SELLOS $', 'Impuesto de sellos'],
    ['DB IVA $ 21% 14.064,63', 'IVA'],
    ['IIBB PERCEP-BSAS 2,00%( 9003,40)', 'Percepción IIBB'],
    ['COMISION CUENTA FULL', 'Comisión cuenta full'],
    ['FABRIC', 'Fabric'],
    ['FLORIDA-EQUUS', 'Florida-Equus'],
  ])('%s → %s', (raw, name) => {
    expect(normalizeMerchant(raw)).toBe(name)
  })
})

describe('guessCategoryName', () => {
  it.each([
    ['Rappi', 'Comida'],
    ['Carrefour', 'Comida'],
    ['Subte', 'Transporte'],
    ['Uber', 'Transporte'],
    ['Farmacity', 'Salud'],
    ['Smart Fit', 'Salud'],
    ['Hoyts', 'Entretenimiento'],
    ['Lojas Renner', 'Ropa'],
  ])('%s → %s', (merchant, category) => {
    expect(guessCategoryName(merchant)).toBe(category)
  })

  it('nothing for an unknown merchant', () => {
    expect(guessCategoryName('Paseo Ronda')).toBeUndefined()
  })
})
