import { useSettings } from './useSettings'

/** Whether the advanced options are shown — off while settings load, so
 *  they never flash in. */
export function useAdvancedMode(): boolean {
  return useSettings()?.advancedMode === true
}
