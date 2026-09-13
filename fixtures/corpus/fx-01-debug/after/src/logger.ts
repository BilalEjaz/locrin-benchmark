// The package's logging: every message goes to standard output with a level prefix.
export function info(msg: string): void {
  console.log(`[info] ${msg}`);
}
