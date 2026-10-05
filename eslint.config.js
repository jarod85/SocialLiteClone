// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'android/*', 'ios/*', 'src/injected/generated/*'],
  },
  {
    // Node build scripts and the Jest setup file.
    files: ['scripts/**/*.js', 'tests/setup.js'],
    languageOptions: {
      globals: { __dirname: 'readonly', require: 'readonly', module: 'writable', console: 'readonly', jest: 'readonly' },
    },
  },
]);
