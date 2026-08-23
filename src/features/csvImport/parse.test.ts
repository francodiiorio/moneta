import { describe, expect, it } from 'vitest'
import { parseCsvFile } from './parse'

function csvFile(content: BlobPart, name = 'extracto.csv'): File {
  return new File([content], name, { type: 'text/csv' })
}

describe('parseCsvFile', () => {
  it('parses a plain comma-delimited CSV with a header row', async () => {
    const csv = 'fecha,descripcion,monto\n23/08/2026,Super,-1500\n24/08/2026,Sueldo,50000\n'
    const rows = await parseCsvFile(csvFile(csv), 'utf-8')
    expect(rows).toEqual([
      ['fecha', 'descripcion', 'monto'],
      ['23/08/2026', 'Super', '-1500'],
      ['24/08/2026', 'Sueldo', '50000'],
    ])
  })

  it('auto-detects a semicolon delimiter (common in bank exports)', async () => {
    const csv = 'fecha;descripcion;monto\n23/08/2026;Super;-1500\n'
    const rows = await parseCsvFile(csvFile(csv), 'utf-8')
    expect(rows).toEqual([
      ['fecha', 'descripcion', 'monto'],
      ['23/08/2026', 'Super', '-1500'],
    ])
  })

  it('handles a quoted field with an embedded comma and delimiter', async () => {
    const csv = 'fecha,descripcion,monto\n23/08/2026,"Super, sucursal centro",-1500\n'
    const rows = await parseCsvFile(csvFile(csv), 'utf-8')
    expect(rows[1]).toEqual(['23/08/2026', 'Super, sucursal centro', '-1500'])
  })

  it('handles a quoted field with an embedded newline', async () => {
    const csv = 'fecha,descripcion,monto\n23/08/2026,"Super\nsucursal centro",-1500\n'
    const rows = await parseCsvFile(csvFile(csv), 'utf-8')
    expect(rows[1]).toEqual(['23/08/2026', 'Super\nsucursal centro', '-1500'])
  })

  it('skips blank lines', async () => {
    const csv = 'fecha,descripcion,monto\n23/08/2026,Super,-1500\n\n24/08/2026,Sueldo,50000\n'
    const rows = await parseCsvFile(csvFile(csv), 'utf-8')
    expect(rows).toHaveLength(3)
  })

  it('decodes windows-1252 encoded accented characters correctly', async () => {
    const latin1Bytes = new Uint8Array([
      ...new TextEncoder().encode('fecha,descripcion\n23/08/2026,'),
      0x4a, 0xf3, 0x73, 0x65, // "J", ó (0xF3 in latin1), s, e -> "Jóse"
      0x0a,
    ])
    const rows = await parseCsvFile(csvFile(latin1Bytes), 'windows-1252')
    expect(rows[1]).toEqual(['23/08/2026', 'Jóse'])
  })
})
