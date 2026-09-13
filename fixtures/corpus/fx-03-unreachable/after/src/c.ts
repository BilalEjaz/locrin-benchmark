export function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
  n = Math.round(n);
}

export function describe(n: number): string {
  if (false) return "never";
  return `value ${n}`;
}
