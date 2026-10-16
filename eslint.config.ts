import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// What is checked beyond the compiler: mistakes the types allow, like promises nobody waits for. How the code is laid
// out is Prettier's (npm run format), so nothing here is about style.
export default defineConfig(
    {
        // what the build makes, and what is not ours
        ignores: ['build/', 'vendor/', 'node_modules/', 'backend/', 'test/reload/driver/extension.js'],
    },
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                // every part of the project is compiled on its own (see npm run typecheck)
                project: ['./tsconfig.json', './src/pages/tsconfig.json', './tsconfig.tools.json', './test/e2e/tsconfig.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // a function may be async to keep to what is expected of it, a promise, without waiting for anything itself
            '@typescript-eslint/require-await': 'off',
            // a name starting with _ is there on purpose, to take a place
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
        },
    },
    {
        files: ['test/**/*.ts'],
        rules: {
            // tests read what tools answer as JSON, and the manifest, which the editor types as "any": checking every
            // step of that would say nothing the assertions do not
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            // node:test runs what describe and it are given itself
            '@typescript-eslint/no-floating-promises': [
                'error',
                {
                    allowForKnownSafeCalls: [
                        { from: 'package', package: 'node:test', name: ['describe', 'it', 'test', 'before', 'after'] },
                    ],
                },
            ],
        },
    },
    {
        // the pages are Preact components: its hooks only work when called the same way on every render
        files: ['src/pages/**/*.tsx'],
        plugins: { 'react-hooks': { rules: reactHooks.rules } },
        rules: { 'react-hooks/rules-of-hooks': 'error' },
    },
);
