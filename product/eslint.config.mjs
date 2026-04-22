// @ts-check
/**
 * Root ESLint config for the product/ monorepo (ESLint 9 flat config).
 *
 * ESLint owns correctness; Prettier owns style — `eslint-config-prettier`
 * is applied last to disable any stylistic rules that would fight Prettier.
 *
 * Per-package overrides (e.g. React for `ui/`) can be added by appending
 * further config objects here, or by each package shipping its own
 * eslint.config.js that extends this one.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Node globals for scripts, configs, and Node-side packages.
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  prettier,
];
