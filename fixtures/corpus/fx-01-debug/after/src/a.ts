export function total(xs: number[]): number {
  let sum = 0;
  for (const x of xs) {
    sum += x;
    console.log("debug", sum);
  }
  return sum;
}
