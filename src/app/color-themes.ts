export interface ColorThemeOption {
  id: string
  label: string
}

// 'indigo' is the app's original palette, defined directly on bare
// :root/.dark in styles.css — it needs no [data-theme] attribute. Every
// other entry here has a matching `[data-theme="<id>"]` block there
// (light and dark variants both). Only decorative/structural tokens are
// themed (background, foreground, card, primary, etc.) — the financial
// semantics (--positive, --negative, --destructive) and the categorical
// chart palette (--chart-1..6) stay constant across every theme: those
// are validated for contrast/colorblind-safety independent of the
// decorative palette, not part of the "look".
export const COLOR_THEMES: ColorThemeOption[] = [
  { id: 'indigo', label: 'Índigo' },
  { id: 'dani', label: 'Dani' },
  { id: 'oceano', label: 'Océano' },
  { id: 'crepusculo', label: 'Crepúsculo' },
  { id: 'abismo', label: 'Abismo' },
]

export const DEFAULT_COLOR_THEME = 'indigo'
