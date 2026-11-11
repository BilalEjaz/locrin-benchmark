import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Catalog } from './catalog.js';

const GUIDES = {
  'quick-reference': 'quickReference',
  composition: 'compositionGrammar',
  installation: 'installation',
  theming: 'theming',
} as const;

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

// What other libraries call these, so an agent asking by a familiar name finds ours.
const ALIASES: Record<string, string[]> = {
  textfield: ['Input', 'Textarea'],
  textinput: ['Input', 'Textarea'],
  modal: ['Dialog', 'Sheet'],
  bottomsheet: ['Sheet', 'ConfirmActionSheet'],
  actionsheet: ['ConfirmActionSheet', 'Sheet'],
  snackbar: ['Toast'],
  dropdown: ['Select', 'DropdownMenu'],
  picker: ['Select', 'DatePickerModal'],
  activityindicator: ['Spinner'],
  loader: ['Spinner', 'LoadingState'],
  chip: ['Badge', 'Toggle'],
  tag: ['Badge'],
  drawer: ['DrawerMenu'],
  navbar: ['Header', 'BottomNav'],
  appbar: ['Header'],
  image: ['SmartImage'],
  radio: ['RadioGroup'],
  divider: ['Separator'],
};

/** Edit distance, for suggesting the component a near-miss name meant. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

export function createServer(catalog: Catalog): McpServer {
  const server = new McpServer({ name: 'whileui', version: catalog.version });
  const byName = new Map(catalog.components.map((c) => [c.name.toLowerCase(), c]));
  const categories = [...new Set(catalog.components.map((c) => c.category))];

  server.registerTool(
    'list_components',
    {
      description:
        `Every component and block in WhileUI ${catalog.version} with a one-line summary. ` +
        'Use it to pick components before writing a screen.',
      inputSchema: {
        category: z
          .string()
          .optional()
          .describe(`Limit to one category: ${categories.join(', ')}`),
      },
    },
    ({ category }) => {
      const rows = catalog.components.filter(
        (c) => !category || c.category.toLowerCase() === category.toLowerCase()
      );
      if (rows.length === 0) {
        return text(`No category "${category}". Categories: ${categories.join(', ')}.`);
      }
      return text(
        rows
          .map(
            (c) =>
              `${c.name} (${c.category}${c.kind === 'template' ? ', copy-paste template' : ''}): ${c.summary}`
          )
          .join('\n')
      );
    }
  );

  server.registerTool(
    'get_component_docs',
    {
      description:
        'Props, examples and usage notes for one or more WhileUI components, from the ' +
        'installed version. Call it before using a component you have not used here before.',
      inputSchema: {
        names: z.array(z.string()).min(1).describe('Component names, e.g. ["Button", "Sheet"]'),
      },
    },
    ({ names }) =>
      text(
        names
          .map((name) => {
            const c = byName.get(name.toLowerCase());
            if (!c) {
              const wanted = name.toLowerCase();
              const names = catalog.components.map((x) => x.name);
              const lookalikes = names.filter((x) => {
                const lower = x.toLowerCase();
                return (
                  lower.includes(wanted) || wanted.includes(lower) || distance(lower, wanted) <= 3
                );
              });
              const known = (ALIASES[wanted] ?? []).filter((x) => names.includes(x));
              const close = [...new Set([...known, ...lookalikes])].slice(0, 5);
              const hint = close.length ? ` Did you mean ${close.join(', ')}?` : '';
              return `## ${name}\n\nNot a WhileUI component.${hint} Call list_components for the list.`;
            }
            const body =
              c.docs ??
              `## ${c.name}\n\n${c.summary}\n\nNo API section yet; the summary is the full description.`;
            return c.source
              ? `${body}\n\nCopy-paste template, not a package export: ${c.source}`
              : body;
          })
          .join('\n\n---\n\n')
      )
  );

  server.registerTool(
    'get_theme_tokens',
    {
      description:
        'The theme token contract: colour tokens (CSS variable, React Native fallback ' +
        'variable, default light and dark values) or visual tokens (radii, control sizes, ' +
        'shadows). A custom theme must define every colour token in both modes.',
      inputSchema: { kind: z.enum(['color', 'visual']).default('color') },
    },
    ({ kind }) =>
      text(
        kind === 'color'
          ? catalog.themeTokens
              .map(
                (t) => `${t.cssVar} / ${t.appVar}  light ${t.light}  dark ${t.dark}  (${t.group})`
              )
              .join('\n')
          : catalog.visualTokens
              .map((t) => `${t.cssVar}  ${String(t.fallback)}  (${t.kind}, ${t.group})`)
              .join('\n')
      )
  );

  server.registerTool(
    'get_guide',
    {
      description:
        'A WhileUI guide. "composition" is the grammar for generated screens; read it, and ' +
        '"quick-reference", before generating UI. "installation" and "theming" cover setup.',
      inputSchema: { topic: z.enum(Object.keys(GUIDES) as [keyof typeof GUIDES]) },
    },
    ({ topic }) => text(catalog.guides[GUIDES[topic]])
  );

  return server;
}
