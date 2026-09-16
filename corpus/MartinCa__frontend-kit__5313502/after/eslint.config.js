// Shared ESLint flat config.
//
// This file is the machine-enforceable half of DESIGN.md. Rules that can be
// linted live here; rules that need judgement live in the prose doc.
//
// Usage in a project's eslint.config.js:
//
//   import config from "@martinrun/frontend-config/eslint";
//   export default config();
//
// To relax a rule for one project, spread and override:
//
//   export default [...config(), { rules: { "no-restricted-syntax": "off" } }];

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

/**
 * @param {object} [options]
 * @param {string[]} [options.ignores] Extra ignore globs.
 * @returns {import("eslint").Linter.Config[]}
 */
export default function config({ ignores = [] } = {}) {
  return tseslint.config(
    { ignores: ["dist", "build", "coverage", "**/*.gen.ts", ...ignores] },

    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,

    {
      files: ["**/*.{ts,tsx}"],
      languageOptions: {
        ecmaVersion: 2022,
        globals: globals.browser,
        parserOptions: {
          projectService: true,
          tsconfigRootDir: process.cwd(),
        },
      },
      plugins: {
        "react-hooks": reactHooks,
        "react-refresh": reactRefresh,
      },
      rules: {
        ...reactHooks.configs.recommended.rules,
        "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

        // --- DESIGN.md section 1: TypeScript is strict, and stays strict ---
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-unsafe-assignment": "error",
        "@typescript-eslint/no-unsafe-member-access": "error",
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { fixStyle: "inline-type-imports" },
        ],
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/no-misused-promises": "error",

        // --- DESIGN.md section 4: structure ---
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["../../*"],
                message:
                  "Use the @/ alias instead of walking up more than one level. See DESIGN.md section 4.",
              },
              {
                group: ["@radix-ui/*", "@base-ui-components/*"],
                message:
                  "Import primitives from @/components/ui/* instead. Direct primitive imports bypass the design system. See DESIGN.md section 3.",
              },
              {
                group: ["moment", "dayjs"],
                message: "Use date-fns. See DESIGN.md section 1.",
              },
            ],
            paths: [
              {
                name: "react",
                importNames: ["default"],
                message:
                  "Import named exports (useState, type ReactNode) rather than the React default export.",
              },
            ],
          },
        ],

        // --- DESIGN.md section 2: state layering ---
        // Server state belongs in TanStack Query, never in a Zustand store.
        "no-restricted-syntax": [
          "error",
          {
            // Both call shapes: create<S>((set) => ...) and the curried form
            // create<S>()((set) => ...) that the Zustand TypeScript docs use.
            // In the curried form the initializer is an argument of the *outer*
            // call, so `callee.name` is undefined there and only
            // `callee.callee.name` matches.
            selector:
              "CallExpression[callee.name='create'] CallExpression[callee.name='fetch'], CallExpression[callee.callee.name='create'] CallExpression[callee.name='fetch']",
            message:
              "Do not fetch inside a Zustand store. Server state belongs in TanStack Query. See DESIGN.md section 2.",
          },
          {
            selector: "JSXAttribute[name.name='style']",
            message:
              "Use Tailwind utilities and theme tokens instead of inline styles. See DESIGN.md section 5.",
          },
        ],

        // --- DESIGN.md section 6: quality floor ---
        eqeqeq: ["error", "always", { null: "ignore" }],
        "no-console": ["warn", { allow: ["warn", "error"] }],
      },
    },

    // Vendored shadcn components — and the kit's own vendored components,
    // like theme-provider.tsx exporting both ThemeProvider and useTheme —
    // are not ours to police.
    {
      files: ["src/components/ui/**", "src/components/theme-provider.tsx"],
      rules: {
        "no-restricted-imports": "off",
        "no-restricted-syntax": "off",
        "react-refresh/only-export-components": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
      },
    },

    // Generated API types are vendored too.
    {
      files: ["src/lib/api-types.ts"],
      rules: { "@typescript-eslint/no-explicit-any": "off" },
    },

    // Config files run in Node and are not type-checked against the app project.
    //
    // disableTypeChecked carries its own `languageOptions` (parserOptions that
    // switch the type-aware parser off), so it has to be spread *before* ours —
    // spreading it after replaces the whole key and silently drops the Node
    // globals, which shows up as no-undef on `process` in a .js config file.
    {
      files: ["*.config.{js,ts}"],
      ...tseslint.configs.disableTypeChecked,
      languageOptions: {
        ...tseslint.configs.disableTypeChecked.languageOptions,
        globals: globals.node,
      },
    },

    prettier,
  );
}
