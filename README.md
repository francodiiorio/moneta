# Moneta

App de finanzas personales, local-first. Sin backend, sin cuenta, sin que tus datos
salgan de tu dispositivo — IndexedDB es la fuente de verdad y un archivo `.finance`
versionado es el mecanismo de backup.

Ver `docs/PRODUCT.md` para qué hace la app y `CLAUDE.md` para cómo está construida.

## Desarrollo

```bash
npm install
npm run dev
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción (typecheck + Vite build + PWA) |
| `npm run preview` | Sirve el build de producción localmente |
| `npm run typecheck` | TypeScript en modo estricto, sin emitir |
| `npm run lint` | ESLint |
| `npm run format` | Prettier (escribe) |
| `npm run test` | Vitest (dominio, repositories, backups) |
| `npm run test:watch` | Vitest en modo watch |
| `npm run test:coverage` | Vitest con reporte de cobertura |
| `npm run e2e` | Playwright (requiere `npx playwright install chromium` una vez) |

## Estructura

```
src/
  app/          entry, router, layout, tema
  components/   UI compartida + primitivos shadcn/ui
  database/     Dexie: instancia + repositories
  domain/       lógica financiera pura (money, currency, ledger, entities)
  lib/          utilidades sin dependencias de dominio
  features/     una carpeta por feature vertical
docs/           documentación de producto, arquitectura, modelo de datos, roadmap
.claude/        agentes y skills para trabajar con Claude Code en este repo
```
