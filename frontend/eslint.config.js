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
    'no-restricted-imports': ['error', { patterns: patterns.map((p) => ({ message, ...p })) }],
  },
})
const deepMessage = 'Import another feature only through its index.ts (AD-11).'
// Slice 2 (AD-4): only src/shared/ui wraps Radix and cmdk; everything else uses the owned components.
// It is merged into the lists below: a second no-restricted-imports block for the same files would replace them.
const libraryOnly = [
  {
    group: ['@radix-ui/*', 'cmdk'],
    message:
      'Use the components in src/shared/ui; only src/shared/ui imports Radix and cmdk (AD-4).',
  },
]

// First-load race (epic 14yq6g334e4): a plain invalidate, refetch, reset or fetch through the query cache does not
// restart a query still on its first load (no data, fetch in flight): it joins that load, whose late response, read
// before the write or event, clears the refresh and leaves the screen stale. Product code refreshes through
// src/api/refresh.ts. Guarded forms: member access (queryClient.invalidateQueries, .fetchQuery, query.invalidate()),
// computed access (queryClient['invalidateQueries']), destructuring ({ invalidateQueries } = queryClient), and
// query.refetch() anywhere but a user's Retry handler (an onClick or onRetry JSX attribute: the query is on an error
// state then, with nothing in flight). A plain call that is safe (the query always has data there, or its first
// loads are restarted elsewhere) is allowed with
// `// eslint-disable-next-line no-restricted-syntax -- first-load safe: <why>` on the line before it.
// It is merged into the .tsx block below: a second no-restricted-syntax block for the same files would replace it.
const cacheRefresh =
  '(invalidate|refetch|reset)Queries|(fetch|prefetch)(Infinite)?Query|ensure(Infinite)?QueryData|invalidate'
const firstLoadMessage =
  'A plain cache refresh joins a first load in flight instead of restarting it: use src/api/refresh.ts, or justify it with "eslint-disable-next-line no-restricted-syntax -- first-load safe: <why>".'
const firstLoadGuard = [
  { selector: `MemberExpression[property.name=/^(${cacheRefresh})$/]`, message: firstLoadMessage },
  {
    selector: `MemberExpression[computed=true][property.value=/^(${cacheRefresh}|refetch)$/]`,
    message: firstLoadMessage,
  },
  {
    selector: `ObjectPattern > Property[key.name=/^(${cacheRefresh}|refetch)$/]`,
    message: firstLoadMessage,
  },
  {
    selector:
      "CallExpression[callee.property.name='refetch']:not(JSXAttribute[name.name=/^(onClick|onRetry)$/] CallExpression)",
    message: firstLoadMessage,
  },
]

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
        {
          // ClickUp 14yq6g334rp: right after a view switch, "Columns" can hit the old view's picker, and the
          // new view then mounts a closed one. openColumns() waits for the view and checks the picker is open.
          selector:
            'Literal[value=/^\\s*columns\\s*$/i], Literal[regex.pattern=/columns/i], TemplateElement[value.raw=/^\\s*columns\\s*$/i]',
          message:
            'Use openColumns() from e2e/helpers.ts: it waits for the view and checks the picker opened.',
        },
      ],
    },
  },
  {
    // The one place that may locate the Columns picker by its text (keeps the e2e/ui.ts rules above).
    files: ['e2e/helpers.ts'],
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
    // Slice 2 (AD-5): product code uses the library Select, never a native <select> (no exception is left since
    // slice 4). Test files and src/test hold <select> fixtures for the helpers. This block sets the rule for files no other
    // no-restricted-syntax block matches, so it does not replace the test guards above or below it.
    files: ['src/**/*.tsx'],
    ignores: ['src/test/**', 'src/**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: 'Use Select from src/shared/ui.',
        },
        ...firstLoadGuard,
      ],
    },
  },
  {
    // First-load race guard for .ts product code (the .tsx files get it in the block above). src/api/refresh.ts holds
    // the helpers; tests and src/test drive the cache directly.
    files: ['src/**/*.ts'],
    ignores: ['src/test/**', 'src/**/*.test.ts', 'src/api/refresh.ts'],
    rules: { 'no-restricted-syntax': ['error', ...firstLoadGuard] },
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
      [
        ...features.filter((other) => other !== feature).flatMap((other) => deepOf(other, true)),
        ...libraryOnly,
      ],
      deepMessage,
    ),
  ),
  boundary(
    ['src/app/**/*.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    [...features.flatMap((feature) => deepOf(feature, false)), ...libraryOnly],
    deepMessage,
  ),
  boundary(['src/design/**/*.{ts,tsx}'], libraryOnly, deepMessage),
  boundary(
    ['src/shared/**/*.{ts,tsx}', 'src/api/**/*.{ts,tsx}'],
    [{ group: ['**/features', '**/features/**'] }],
    'src/shared and src/api must not import src/features (AD-11).',
  ),
)
