import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// AD-11: a feature is imported only through its index.ts, and shared/api never import features.
const features = [
  'auth',
  'workspace',
  'locations',
  'tasks',
  'comments',
  'statuses',
  'fields',
  'views',
  'realtime',
  'search',
  'serviceAccounts',
  'dependencies',
  'automations',
  'notifications',
]
const deepOf = (name, relative) => [
  { group: [`**/features/${name}/**`, `!**/features/${name}/index*`] },
  ...(relative ? [{ group: [`../${name}/**`, `!../${name}/index*`] }] : []),
]
const boundary = (files, patterns, message) => ({
  files,
  rules: {
    'no-restricted-imports': ['error', { patterns: patterns.map((p) => ({ ...p, message })) }],
  },
})
const deepMessage = 'Import another feature only through its index.ts (AD-11).'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'src/api/schema.d.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // AD-5: only src/api talks HTTP.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/api/**', 'src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Use the generated client in src/api/client.ts.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'fetch',
          message: 'Use the generated client in src/api/client.ts.',
        },
        {
          object: 'globalThis',
          property: 'fetch',
          message: 'Use the generated client in src/api/client.ts.',
        },
      ],
    },
  },
  {
    // Slice 1: e2e specs pick, read and list select-like controls only through e2e/ui.ts,
    // by visible label. (toHaveValue stays legal on text inputs; select reads are reviewed.)
    files: ['e2e/**/*.ts'],
    ignores: ['e2e/ui.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='selectOption']",
          message: 'Use pick() from e2e/ui.ts: it picks by visible label.',
        },
        {
          selector: 'Literal[value=/option:checked/]',
          message: 'Use valueOf() or expectValue() from e2e/ui.ts.',
        },
        {
          selector: 'TemplateElement[value.raw=/option:checked/]',
          message: 'Use valueOf() or expectValue() from e2e/ui.ts.',
        },
      ],
    },
  },
  {
    // Slice 1: component tests pick, read and list select-like controls only through src/test/ui.ts.
    // toHaveValue and findByRole('option') stay legal (inputs, typed comboboxes); select uses are reviewed.
    files: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='selectOptions']",
          message: 'Use pick() from src/test/ui.ts: it picks by visible label.',
        },
        {
          selector: "CallExpression[callee.property.name='toHaveDisplayValue']",
          message: 'Use expectValue() from src/test/ui.ts.',
        },
        {
          selector: "TSAsExpression[typeAnnotation.typeName.name='HTMLSelectElement']",
          message: 'Use valueOf() or optionsOf() from src/test/ui.ts.',
        },
      ],
    },
  },
  ...features.map((feature) =>
    boundary(
      [`src/features/${feature}/**/*.{ts,tsx}`],
      features.filter((other) => other !== feature).flatMap((other) => deepOf(other, true)),
      deepMessage,
    ),
  ),
  boundary(
    ['src/app/**/*.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    features.flatMap((feature) => deepOf(feature, false)),
    deepMessage,
  ),
  boundary(
    ['src/shared/**/*.{ts,tsx}', 'src/api/**/*.{ts,tsx}'],
    [{ group: ['**/features', '**/features/**'] }],
    'src/shared and src/api must not import src/features (AD-11).',
  ),
)
