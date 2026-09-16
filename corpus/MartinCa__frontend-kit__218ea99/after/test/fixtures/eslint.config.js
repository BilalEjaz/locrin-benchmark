// Entry point the test lints these fixtures with.
//
// `config()` bakes in `tsconfigRootDir: process.cwd()`, which would be the repo
// root when the test runs. Point it at this directory instead so the fixture
// tsconfig.json is the one the type-aware rules use.
import config from "../../eslint.config.js";

export default [
  ...config(),
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
];
