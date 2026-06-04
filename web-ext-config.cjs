// Config for the `web-ext` CLI (run / lint / sign). Operates on the built extension.
module.exports = {
  sourceDir: './dist',
  ignoreFiles: ['package.json', 'package-lock.json'],
  build: {
    overwriteDest: true
  }
}
