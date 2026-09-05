import { useEffect, type ReactNode } from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { useLiveQuery } from 'dexie-react-hooks'
import { settingsRepo } from '@/database/repositories'
import { DEFAULT_COLOR_THEME } from './color-themes'

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="moneta-theme"
    >
      <ColorThemeEffect />
      {children}
    </NextThemesProvider>
  )
}

/** Applies Settings.colorTheme as a `data-theme` attribute on <html> — a
 *  separate axis from next-themes' own light/dark `class` attribute above.
 *  See styles.css's `[data-theme="..."]` blocks and src/app/color-themes.ts. */
function ColorThemeEffect() {
  const settings = useLiveQuery(() => settingsRepo.getSettings())

  useEffect(() => {
    const colorTheme = settings?.colorTheme
    if (colorTheme && colorTheme !== DEFAULT_COLOR_THEME) {
      document.documentElement.dataset.theme = colorTheme
    } else {
      delete document.documentElement.dataset.theme
    }
  }, [settings?.colorTheme])

  return null
}
