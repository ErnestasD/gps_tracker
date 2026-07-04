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
        projectService: true,
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
)
