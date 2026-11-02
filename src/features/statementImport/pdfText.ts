import { getDocument, GlobalWorkerOptions, PasswordException } from 'pdfjs-dist'
// Bundled with the app — never a CDN: the PDF is read on this device and
// nothing about it leaves it (see docs/DECISIONS.md, Etapa 9 Fase 2).
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { groupTokensIntoLines, parseBbvaStatement, StatementParseError, type ParsedStatement } from './bbva'

GlobalWorkerOptions.workerSrc = workerUrl

/** Reads a card statement PDF into its parsed form. Errors are
 *  user-facing (Spanish). */
export async function readStatementPdf(file: File): Promise<ParsedStatement> {
  let pages: { x: number; y: number; width: number; text: string }[][]
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  try {
    const doc = await task.promise
    pages = []
    for (let number = 1; number <= doc.numPages; number++) {
      const content = await (await doc.getPage(number)).getTextContent()
      pages.push(
        content.items.flatMap((item) =>
          'str' in item
            ? [{ x: item.transform[4] as number, y: item.transform[5] as number, width: item.width, text: item.str }]
            : [],
        ),
      )
    }
  } catch (error) {
    if (error instanceof PasswordException) throw new StatementParseError('El PDF tiene contraseña: descargalo sin contraseña desde el banco')
    throw new StatementParseError('No se pudo leer el PDF')
  } finally {
    // Always: a worker per failed attempt would otherwise stay alive.
    await task.destroy()
  }
  return parseBbvaStatement(groupTokensIntoLines(pages))
}
