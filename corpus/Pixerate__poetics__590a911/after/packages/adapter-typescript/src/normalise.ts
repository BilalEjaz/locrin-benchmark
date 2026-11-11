// Normalised syntax trees: what a content hash is taken over. Comments and
// formatting never reach the tree, and neither does anything a formatter may
// rewrite without changing meaning (quotes, redundant parentheses, numeric
// spelling, quoted property names, JSX text wrapping).
import { createHash } from "node:crypto";
import ts from "typescript";

/** `[kind, ...children]` for nodes, `[kind, text]` for names and literals. */
export type NormalTree = readonly [string, ...(NormalTree | string)[]];

export interface NormaliseOptions {
  /** Drop type annotations, type-only declarations and TypeScript-only modifiers, leaving what runs. */
  eraseTypes?: boolean;
  /** Nodes left out, such as the unit's own name, so a rename alone keeps its content hash. */
  omit?: ReadonlySet<ts.Node>;
}

// The first name for each kind: later names with the same value are range markers such as FirstStatement.
const KIND_NAMES = new Map<number, string>();
for (const [name, value] of Object.entries(ts.SyntaxKind)) {
  if (typeof value === "number" && !KIND_NAMES.has(value)) KIND_NAMES.set(value, name);
}

const kindName = (kind: ts.SyntaxKind) => KIND_NAMES.get(kind) ?? String(kind);

// Modifiers that say how a declaration is exported, not what it does.
const EXPORT_MODIFIERS = new Set([ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.DefaultKeyword]);

const TYPE_ONLY_MODIFIERS = new Set([
  ts.SyntaxKind.PublicKeyword,
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
  ts.SyntaxKind.AbstractKeyword,
  ts.SyntaxKind.DeclareKeyword,
  ts.SyntaxKind.OverrideKeyword,
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.OutKeyword,
]);

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The normalised tree of `node`, independent of comments and formatting. */
export function normaliseNode(node: ts.Node, options: NormaliseOptions = {}): NormalTree {
  const tree = visit(node, options);
  return tree ?? ["Erased"];
}

// How many levels below each node its shingle sees: enough to tell `a.b(c)` from `a.b(d)`, few
// enough that an edit only changes the shingles of the nodes near it.
const SHINGLE_DEPTH = 2;

/**
 * What identity matching compares when a unit was edited as well as renamed or
 * moved: one hash per internal node of `tree`, each over the node and the
 * levels just below it, sorted. A hash seen more than once is numbered
 * (`hash#2`), so the list works as a multiset. Leaves alone are left out, since
 * every unit shares them.
 */
export function fingerprint(tree: NormalTree): string[] {
  const counts = new Map<string, number>();
  const walk = (node: NormalTree) => {
    const children = node.slice(1);
    if (!children.some((child) => typeof child !== "string")) return;
    const hash = createHash("sha1").update(shingle(node, SHINGLE_DEPTH)).digest("hex").slice(0, 16);
    counts.set(hash, (counts.get(hash) ?? 0) + 1);
    for (const child of children) if (typeof child !== "string") walk(child);
  };
  walk(tree);
  return [...counts].flatMap(([hash, count]) => Array.from({ length: count }, (_, i) => (i === 0 ? hash : `${hash}#${i + 1}`))).sort();
}

function shingle(node: NormalTree | string, depth: number): string {
  if (typeof node === "string") return JSON.stringify(node);
  const [kind, ...children] = node;
  if (depth === 0) return kind;
  return `${kind}(${children.map((child) => shingle(child, depth - 1)).join(",")})`;
}

function visit(node: ts.Node, options: NormaliseOptions): NormalTree | undefined {
  if (options.omit?.has(node)) return undefined;
  if (EXPORT_MODIFIERS.has(node.kind)) return undefined;
  // The tree already encodes grouping, so parentheses a formatter adds or drops change nothing.
  if (ts.isParenthesizedExpression(node)) return visit(node.expression, options);
  if (ts.isParenthesizedTypeNode(node)) return visit(node.type, options);
  if (options.eraseTypes) {
    const erased = erase(node, options);
    if (erased !== false) return erased;
  }
  const leaf = leafText(node);
  if (leaf !== undefined) return leaf === null ? undefined : [leafKind(node), leaf];

  const out: Array<NormalTree | string> = [];
  // Facts the parser keeps outside child nodes, without which `!a` and `-a`, or `let` and `const`, would hash alike.
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node) || ts.isTypeOperatorNode(node)) out.push(kindName(node.operator));
  if (ts.isMetaProperty(node)) out.push(kindName(node.keywordToken));
  if (ts.isHeritageClause(node)) out.push(kindName(node.token));
  if (ts.isVariableDeclarationList(node)) out.push(declarationKeyword(node));
  // `(a?.b).c` and `a?.b.c` differ only in where the optional chain ends.
  if (node.flags & ts.NodeFlags.OptionalChain) out.push("?.");
  if ("isTypeOnly" in node && node.isTypeOnly === true) out.push("type");
  node.forEachChild((child) => {
    const tree = visit(child, options);
    if (tree) out.push(tree);
  });
  return [kindName(node.kind), ...out];
}

/** `false` when erasure does not apply to `node`; `undefined` when the node is erased entirely. */
function erase(node: ts.Node, options: NormaliseOptions): NormalTree | undefined | false {
  if (ts.isExpressionWithTypeArguments(node)) return ["ExpressionWithTypeArguments", ...[visit(node.expression, options)].filter((t) => t !== undefined)];
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
    return visit(node.expression, options);
  }
  if (ts.isTypeNode(node) || ts.isTypeParameterDeclaration(node)) return undefined;
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return undefined;
  if (TYPE_ONLY_MODIFIERS.has(node.kind)) return undefined;
  // Overload signatures and `declare function` have no body to run.
  if (ts.isFunctionDeclaration(node) && !node.body) return undefined;
  if (ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ImplementsKeyword) return undefined;
  // `?` and `!` on a declaration are type-level; the `?` of `a ? b : c` is not, and is a different parent.
  if (node.kind === ts.SyntaxKind.QuestionToken || node.kind === ts.SyntaxKind.ExclamationToken) {
    const parent = node.parent;
    if (ts.isParameter(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isVariableDeclaration(parent)) return undefined;
  }
  return false;
}

/** The text of a name or literal, `null` for text that carries nothing, `undefined` for other nodes. */
function leafText(node: ts.Node): string | null | undefined {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return String(Number(node.text.replaceAll("_", "")));
  if (ts.isBigIntLiteral(node)) return node.text.replaceAll("_", "").toLowerCase();
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node) || ts.isRegularExpressionLiteral(node)) return node.text;
  if (ts.isJsxText(node)) {
    if (node.containsOnlyTriviaWhiteSpaces) return null;
    return jsxText(node.text) || null;
  }
  return undefined;
}

// `{ "a": 1 }` and `{ a: 1 }` are the same object; formatters quote and unquote keys freely.
function leafKind(node: ts.Node): string {
  if (ts.isStringLiteral(node) && isPropertyName(node) && IDENTIFIER.test(node.text)) return kindName(ts.SyntaxKind.Identifier);
  return kindName(node.kind);
}

/**
 * JSX's own whitespace rule: whitespace touching a line break is dropped and the
 * lines are joined with one space, so re-wrapped text renders, and hashes, the
 * same. Spaces on a single line, as in `Hello {name}`, are kept.
 */
function jsxText(text: string): string {
  const lines = text.split(/\r\n|\n|\r/);
  const kept: string[] = [];
  lines.forEach((line, i) => {
    let part = line;
    if (i > 0) part = part.trimStart();
    if (i < lines.length - 1) part = part.trimEnd();
    if (part !== "") kept.push(part);
  });
  return kept.join(" ");
}

function isPropertyName(node: ts.StringLiteral): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent)) &&
    parent.name === node
  );
}

function declarationKeyword(list: ts.VariableDeclarationList): string {
  if ((list.flags & ts.NodeFlags.AwaitUsing) === ts.NodeFlags.AwaitUsing) return "await using";
  if (list.flags & ts.NodeFlags.Using) return "using";
  if (list.flags & ts.NodeFlags.Const) return "const";
  if (list.flags & ts.NodeFlags.Let) return "let";
  return "var";
}
