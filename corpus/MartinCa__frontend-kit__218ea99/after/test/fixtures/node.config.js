// Regression fixture: a .js config file in a consuming project (SETUP.md Part 6
// tells every project to write eslint.config.js and prettier.config.js).
//
// The shared config's override for these has to keep globals.node. Spreading
// tseslint's disableTypeChecked after `languageOptions` silently replaced the
// whole key, which surfaced here as no-undef on both identifiers below.
export default {
  root: process.cwd(),
  here: __dirname,
};
