import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

const jsFiles = ['**/*.{js,mjs,cjs}']
const vueFiles = ['**/*.vue']

export default [
  {
    ...js.configs.recommended,
    files: jsFiles
  },
  {
    files: jsFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.webextensions
      }
    },
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_|^error$'
      }]
    }
  },
  ...pluginVue.configs['flat/recommended'].map(config => ({
    ...config,
    files: vueFiles
  })),
  {
    files: vueFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions
      }
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'warn'
    }
  },
  {
    ignores: ['node_modules/**', 'dist/**', '**/*.html', 'icons/**']
  }
]
