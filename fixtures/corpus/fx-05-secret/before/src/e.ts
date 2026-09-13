export function signingKey(): string {
  return process.env.WEBHOOK_SIGNING_KEY ?? "";
}
