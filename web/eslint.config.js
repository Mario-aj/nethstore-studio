import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['dist', 'dev-dist', 'coverage', 'playwright-report', 'test-results', 'node_modules'],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'scripts/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden (CSP and XSS policy).',
        },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js', '*.config.ts', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // vi.fn() methods are asserted on detached; that is how Vitest mocks are used.
    files: ['src/**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },
  {
    // Playwright fixtures call `use()`, which is not React's hook.
    files: ['tests/**/*.ts'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
);
