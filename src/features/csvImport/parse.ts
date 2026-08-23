import Papa from 'papaparse'

export type CsvEncoding = 'utf-8' | 'windows-1252'

export const CSV_ENCODINGS: { value: CsvEncoding; label: string }[] = [
  { value: 'utf-8', label: 'UTF-8 (la mayoría de los bancos)' },
  { value: 'windows-1252', label: 'Latin-1 / Windows-1252 (extractos viejos)' },
]

/**
 * Reads `file` as raw bytes (not text) and decodes with the chosen
 * encoding before parsing — some older Argentine bank exports are
 * Latin-1, not UTF-8, and decoding those as UTF-8 mangles accented
 * characters. `TextDecoder` supports both labels natively, no library
 * needed just for this. Delimiter is auto-detected by papaparse across
 * the common ones (`,`, `;`, tab) — no delimiter picker in the UI.
 */
export async function parseCsvFile(file: File, encoding: CsvEncoding): Promise<string[][]> {
  const buffer = await file.arrayBuffer()
  const text = new TextDecoder(encoding).decode(buffer)

  const result = Papa.parse<string[]>(text, { skipEmptyLines: true })
  return result.data
}
