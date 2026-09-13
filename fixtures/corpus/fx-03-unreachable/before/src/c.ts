export function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

export function describe(n: number): string {
  return `value ${n}`;
}
