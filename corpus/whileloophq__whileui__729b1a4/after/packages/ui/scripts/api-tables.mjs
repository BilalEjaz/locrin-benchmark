/**
 * Reads a component's props from its TypeScript types, so the README's API tables are
 * generated instead of hand-maintained.
 *
 * A row comes from each prop the component declares itself (inherited React Native
 * props are summarised, not listed), plus its `tailwind-variants` options. The default is
 * an `@default` doc tag, else the parameter's default in the component, else the variant's
 * `defaultVariants` entry. The description is the prop's doc comment.
 */
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(PKG, 'src');

export function createApiReader() {
  const program = ts.createProgram([join(SRC, 'index.ts')], {
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  });
  const checker = program.getTypeChecker();
  const ours = (file) => file.startsWith(SRC + sep) && !file.includes(`${sep}test${sep}`);
  const interfaces = new Map();
  for (const file of program.getSourceFiles()) {
    if (!ours(file.fileName)) continue;
    ts.forEachChild(file, (node) => {
      if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith('Props')) {
        interfaces.set(node.name.text, node);
      }
    });
  }

  /** Default values written as destructuring defaults anywhere in the props' file. */
  function parameterDefaults(file) {
    const defaults = new Map();
    const visit = (node) => {
      if (ts.isBindingElement(node) && node.initializer && ts.isIdentifier(node.name)) {
        if (!defaults.has(node.name.text)) defaults.set(node.name.text, node.initializer.getText());
      }
      // Frosted components pass their defaults to useFrostedSurface rather than destructure.
      if (ts.isPropertyAssignment(node) && node.name.getText() === 'defaultTintToken') {
        defaults.set('blurTintToken', node.initializer.getText());
      }
      if (ts.isPropertyAssignment(node) && node.name.getText() === 'defaultBlurPreset') {
        defaults.set('blurIntensity', {
          plain: `${node.initializer.getText().replace(/'/g, '')} preset`,
        });
      }
      if (ts.isPropertyAssignment(node) && node.name.getText() === 'defaultVariants') {
        for (const prop of node.initializer.properties ?? []) {
          if (ts.isPropertyAssignment(prop) && !defaults.has(prop.name.getText())) {
            defaults.set(prop.name.getText(), prop.initializer.getText());
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    return defaults;
  }

  // One line, no trailing `| undefined`, and single-quoted literals as the README writes them.
  const clean = (text) =>
    text
      .replace(/\s+/g, ' ')
      .replace(/\s*\| undefined$/, '')
      .replace(/"([^"]*)"/g, "'$1'")
      .trim();

  /** Rows for `<Name>Props`, or null when no such interface exists. */
  function propsOf(name) {
    const node = interfaces.get(`${name}Props`);
    if (!node) return null;
    const type = checker.getTypeAtLocation(node);
    const defaults = parameterDefaults(node.getSourceFile());
    const rows = [];
    let inherits = false;
    const heritage = node.heritageClauses?.flatMap((clause) => clause.types) ?? [];
    // `VariantProps<typeof xVariants>` is a mapped type: its options have no declaration
    // of their own, so read them from the clause.
    const variantOptions = new Set(
      heritage
        .filter((t) => t.expression.getText() === 'VariantProps')
        .flatMap((t) =>
          checker.getPropertiesOfType(checker.getTypeAtLocation(t)).map((p) => p.name)
        )
    );
    for (const symbol of checker.getPropertiesOfType(type)) {
      const declaration = symbol.declarations?.[0];
      const file = declaration?.getSourceFile().fileName ?? '';
      const variantOption = variantOptions.has(symbol.name);
      if (!ours(file) && !variantOption) {
        inherits = true;
        continue;
      }
      const propType = checker.getTypeOfSymbolAtLocation(symbol, node);
      const tags = symbol.getJsDocTags(checker);
      const tagged = tags.find((tag) => tag.name === 'default');
      const fallback = defaults.get(symbol.name);
      // The type as written ("React.ReactNode", "ShadowTier") reads better than its expansion.
      const written =
        declaration && ts.isPropertySignature(declaration)
          ? declaration.type?.getText()
          : undefined;
      rows.push({
        name: symbol.name,
        type: clean(written ?? checker.typeToString(checker.getNonNullableType(propType))),
        optional: (symbol.flags & ts.SymbolFlags.Optional) !== 0,
        default:
          typeof fallback === 'object' && !tagged
            ? fallback
            : (tagged ? ts.displayPartsToString(tagged.text) : fallback)?.replace(/^`|`$/g, ''),
        description: ts
          .displayPartsToString(symbol.getDocumentationComment(checker))
          .replace(/\s+/g, ' '),
      });
    }
    // Name the parent that supplies the props left out of the table, not one already listed.
    const base = heritage
      .filter((t) =>
        checker.getPropertiesOfType(checker.getTypeAtLocation(t)).some((p) => {
          const file = p.declarations?.[0]?.getSourceFile().fileName ?? '';
          return !ours(file) && !variantOptions.has(p.name);
        })
      )
      .map((t) => /\b(\w+Props)\b/.exec(t.getText())?.[1])
      .find(Boolean);
    return { rows, inherits, base, file: relative(PKG, node.getSourceFile().fileName) };
  }

  return { propsOf, interfaceNames: () => [...interfaces.keys()] };
}

const cell = (text) => text.replace(/\|/g, '\\|');

/** A README table for one component's props. */
export function renderTable({ rows, inherits, base }) {
  const lines = [
    '| Prop | Type | Default | Description |',
    '| ---- | ---- | ------- | ----------- |',
    ...rows.map((row) => {
      const name = row.optional ? row.name : `${row.name} (required)`;
      const fallback =
        typeof row.default === 'object'
          ? row.default.plain
          : row.default
            ? `\`${cell(row.default)}\``
            : '—';
      return `| ${name} | \`${cell(row.type)}\` | ${fallback} | ${cell(row.description)} |`;
    }),
  ];
  if (inherits) {
    // `RNViewProps` is an import alias for React Native's own `ViewProps`.
    const source = !base
      ? 'the underlying primitive'
      : base.startsWith('RN')
        ? `React Native's \`${base.slice(2)}\``
        : `\`${base}\``;
    lines.push('', `Also accepts the props of ${source}.`);
  }
  return lines.join('\n');
}
