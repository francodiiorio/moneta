import { backupRepo } from '@/database/repositories'

/** Same-browser, same-origin only — tabs of this app talking to each
 *  other; nothing ever leaves the device. */
const CHANNEL = 'moneta-data'
const WIPED = 'data-wiped'

/** "Borrar todos los datos": erases everything stored in this browser, then
 *  tells every other open tab of the app, so none keeps showing (or
 *  writing over) data that's gone. */
export async function deleteAllData(): Promise<void> {
  await backupRepo.wipeAllTables()
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(CHANNEL)
  channel.postMessage(WIPED)
  channel.close()
}

/** Calls `onWiped` when another tab erased all data. Returns the cleanup. */
export function onDataWipedElsewhere(onWiped: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined
  const channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = (event: MessageEvent) => {
    if (event.data === WIPED) onWiped()
  }
  return () => channel.close()
}
