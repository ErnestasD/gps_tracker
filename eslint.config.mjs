import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.turbo/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // apps/web config/e2e files typecheck under tsconfig.node.json/tsconfig.sw.json
          // (see its package.json typecheck script); projectService only auto-discovers
          // tsconfig.json, so these lint via the default project instead
          allowDefaultProject: [
            'apps/web/vite.config.ts',
            'apps/web/sw.ts',
            'apps/web/playwright.config.ts',
            'apps/web/tests/pw/*.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message:
                'DB access only via packages/db scoped repositories (CLAUDE.md rule 2).',
            },
          ],
          patterns: [
            {
              group: ['@prisma/client/*'],
              message:
                'DB access only via packages/db scoped repositories (CLAUDE.md rule 2) — deep imports included.',
            },
          ],
        },
      ],
    },
  },
  {
    // the one place Prisma is allowed (CLAUDE.md rule 2)
    files: ['packages/db/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // typed-checked separately by apps/web tsconfig.node.json/tsconfig.sw.json;
    // the eslint default project resolves their ESM-only plugin types as any
    files: ['apps/web/vite.config.ts', 'apps/web/sw.ts', 'apps/web/playwright.config.ts', 'apps/web/tests/pw/**'],
    ...tseslint.configs.disableTypeChecked,
  },
)
