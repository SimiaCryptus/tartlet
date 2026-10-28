// Lint encodes the hard rules from idea.md §5.2 and §6.2, and plan.md §2.
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

const CORE = ['packages/{time,mini,syntax,ir,registry,check,random,core}/src/**/*.ts'];
// Packages that carry musical time. `mini` and `syntax` deal only in source offsets (UTF-16
// indices), which are plain numbers by design: the parser knows nothing about time (idea.md §6.2).
const TIME_PKGS = ['packages/{time,ir,registry,check,random,core}/src/**/*.ts'];

const BASE_SYNTAX = [
  { selector: "ImportExpression[source.type!='Literal']", message: 'Dynamic import() needs a literal specifier.' },
  {
    selector: 'CallExpression[callee.name=/^set(Timeout|Interval)$/][arguments.0.type=/Literal|TemplateLiteral/]',
    message: 'String timers are code evaluation.',
  },
  { selector: "NewExpression[callee.name='Function']", message: 'No runtime code generation.' },
];
const BASE_GLOBALS = [
  { name: 'Function', message: 'No runtime code generation.' },
  { name: 'eval', message: 'Tartlet never evaluates source.' },
];
const CORE_SYNTAX = [
  ...BASE_SYNTAX,
  { selector: "NewExpression[callee.name='Date']", message: 'No wall clock in the core path.' },
  {
    selector: 'ObjectExpression[properties.length=0]',
    message: 'Use Map or Object.create(null) for dictionaries.',
  },
];
const TIME_FIELD = {
  selector: 'TSPropertySignature[key.name=/^(begin|end|cycle|whole|part)$/] TSNumberKeyword',
  message: 'Musical time is Rational, never number.',
};

const deps = (pkg, allowed) => ({
  files: [`packages/${pkg}/src/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@tartlet/*', ...allowed.map((a) => `!@tartlet/${a}`)],
            message: 'Violates the package dependency graph (plan.md §4).',
          },
        ],
      },
    ],
  },
});

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'corpus/**', '**/*.js', '**/*.mjs'] },
  ...tseslint.configs.strictTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  {
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-globals': ['error', ...BASE_GLOBALS],
      'no-restricted-syntax': ['error', ...BASE_SYNTAX],
    },
  },
  {
    files: CORE,
    plugins: { security },
    rules: {
      ...security.configs.recommended.rules,
      // Every hit is numeric array indexing or a typed key. Prototype safety is enforced
      // structurally instead: Map / Object.create(null) dictionaries (rule below) and the
      // Z-07 / Z-10 tests (idea.md §6.2).
      'security/detect-object-injection': 'off',
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use @tartlet/random seed paths.' },
        { object: 'Date', property: 'now', message: 'No wall clock in the core path.' },
        { object: 'performance', property: 'now', message: 'No wall clock in the core path.' },
      ],
      'no-restricted-globals': [
        'error',
        ...BASE_GLOBALS,
        'window',
        'document',
        'fetch',
        'setTimeout',
        'setInterval',
        'XMLHttpRequest',
      ],
      'no-restricted-syntax': ['error', ...CORE_SYNTAX],
    },
  },
  {
    files: TIME_PKGS,
    rules: { 'no-restricted-syntax': ['error', ...CORE_SYNTAX, TIME_FIELD] },
  },
  {
    // In tests a wrong shape assumption fails the test anyway.
    files: ['packages/*/test/**/*.ts', 'e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  deps('time', []),
  deps('mini', ['time']),
  deps('syntax', ['mini']),
  deps('ir', ['time', 'mini']),
  deps('registry', ['ir']),
  deps('random', ['time']),
  deps('check', ['syntax', 'mini', 'ir', 'registry', 'random', 'time']),
  deps('core', ['time', 'mini', 'ir', 'registry', 'random']),
  deps('resources', ['ir']),
  deps('schedule', ['core', 'time']),
  deps('webaudio', ['schedule', 'time', 'ir', 'resources']),
  deps('worker', ['check', 'core', 'ir', 'time']),
);
