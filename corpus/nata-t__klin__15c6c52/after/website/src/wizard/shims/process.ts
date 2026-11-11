/**
 * What the CLI's UI modules read from `process`: truecolor, a Unicode
 * terminal, and a stdout that's always a TTY. The size is whatever the
 * on-page terminal reports.
 */
export const terminalSize = { columns: 112, rows: 36 }

const noop = () => {}

export const process = {
  env: { FORCE_COLOR: "3", COLORTERM: "truecolor", TERM: "xterm-256color" } as Record<string, string | undefined>,
  platform: "linux",
  versions: {} as Record<string, string>,
  argv: [] as string[],
  cwd: () => "/home/you/code",
  exit: noop,
  on: noop,
  once: noop,
  off: noop,
  stdout: {
    isTTY: true,
    get columns() {
      return terminalSize.columns
    },
    get rows() {
      return terminalSize.rows
    },
    write: () => true,
    on: noop,
    off: noop,
    getColorDepth: () => 24,
  },
  stdin: { isTTY: true, on: noop, off: noop, setRawMode: noop, resume: noop, pause: noop },
}
