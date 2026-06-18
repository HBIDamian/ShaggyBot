const js = require('@eslint/js');

module.exports = [
  // Base recommended rules
  js.configs.recommended,

  // Global ignores
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'logs/**',
      'resources/**',
    ],
  },

  // Main config for all source files
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        Buffer: 'readonly',
        crypto: 'readonly',
        // Node 18+ built-in globals
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['warn', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-throw-literal': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'eqeqeq': ['error', 'always'],
      'no-console': 'off',
      'no-multiple-empty-lines': ['warn', { max: 2 }],
      'no-trailing-spaces': 'warn',
      'semi': ['warn', 'always'],
      'curly': ['warn', 'all'],
      'arrow-body-style': ['warn', 'as-needed'],
      'prefer-arrow-callback': 'warn',
      'no-unused-expressions': 'error',
      'no-floating-decimal': 'error',
      'no-new-wrappers': 'error',
      'no-async-promise-executor': 'error',
      'no-promise-executor-return': 'error',
      'max-params': ['warn', 5],
      'max-depth': ['warn', 4],
      'complexity': ['warn', 20],
    },
  },

  // Relaxed rules for command/event/contextMenu files
  {
    files: ['src/commands/**/*.js', 'src/events/**/*.js', 'src/contextMenus/**/*.js'],
    rules: {
      'no-unused-vars': ['warn', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^(interaction|client|message|_next|_req|_res|_)',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
];
