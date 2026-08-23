import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Layer boundaries — see docs/ARCHITECTURE.md "Reglas de capas".
// domain/ is pure TS with zero I/O; database/ is the only place that
// touches Dexie; features/ own their vertical slice.
const noRestrictedImportsRule = (extraPatterns = []) => [
  'error',
  {
    patterns: [
      {
        group: ['@/database*', '@/features/*'],
        message: 'domain/ must stay free of persistence and feature imports.',
      },
      { group: ['react', 'react-dom*'], message: 'domain/ must stay framework-free.' },
      ...extraPatterns,
    ],
  },
]

export default defineConfig([
  globalIgnores([
    'dist',
    'dev-dist',
    'node_modules',
    'coverage',
    'playwright-report',
    'test-results',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': noRestrictedImportsRule(),
    },
  },
  {
    files: ['src/database/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': noRestrictedImportsRule([
        { group: ['@/features/*'], message: 'database/ must stay free of feature imports.' },
      ]),
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      // Vendored shadcn/ui output — not hand-audited to app conventions.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
])
