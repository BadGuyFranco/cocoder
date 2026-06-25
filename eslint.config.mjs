// ESLint flat config - CoCoder engine repo.
//
// Scope: TypeScript engine sources plus root maintenance/proof scripts.
// Purpose: catch high-value defects that TypeScript and Vitest can miss:
// unhandled promises, dangerous eval-family execution, leftover debug output,
// and dead arguments/imports/locals.
//
// Intentionally restrained. This is a safety net, not a formatter or style
// police; add rules only when they protect runtime behavior.

import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      // packages/ui is excluded from root typecheck today; keep lint aligned
      // until the UI has its own scoped gate.
      'packages/ui/**',
    ],
  },
  {
    files: ['packages/*/src/**/*.ts', 'scripts/**/*.mjs'],

    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },

    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },

    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    rules: {
      // Root scripts are proof/reporting commands; stdout is their user-facing artifact.
      'no-console': 'off',
    },
  },
];
